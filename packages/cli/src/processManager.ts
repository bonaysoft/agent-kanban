import { type ChildProcess, spawn } from "node:child_process";
import type { AgentClient, ApiClient } from "./client.js";
import { createLogger } from "./logger.js";
import type { AgentEvent, AgentProvider } from "./providers/types.js";
import { removeSession, updateSession } from "./sessionStore.js";
import { cleanupPromptFile } from "./systemPrompt.js";

const logger = createLogger("process");

// Agent Process Lifecycle:
//   SPAWN → stdin task notification → RUNNING
//     agent claims task via CLI, works, completes via CLI
//     stdout (stream-json) → parse events → POST /messages
//   EXIT(0) → log success → cleanup
//   EXIT(N) → POST /release (crash recovery) → cleanup
//   KILL (shutdown) → POST /release → cleanup

export interface SpawnRequest {
  provider: AgentProvider;
  taskId: string;
  sessionId: string;
  cwd: string;
  taskContext: string;
  agentClient: AgentClient;
  agentEnv: Record<string, string>;
  systemPromptFile?: string;
  resume?: boolean;
  onCleanup?: () => void;
  model?: string;
}

interface AgentProcess {
  taskId: string;
  sessionId: string;
  process: ChildProcess;
  provider: AgentProvider;
  agentClient: AgentClient;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  rateLimited?: boolean;
  resultReceived?: boolean;
  onCleanup?: () => void;
}

export interface ProcessManagerCallbacks {
  onSlotFreed: () => void;
  onRateLimited: (runtime: string, resetAt: string) => void;
  onRateLimitCleared?: (runtime: string) => void;
  onProcessStarted?: (sessionId: string, pid: number) => void;
  onProcessExited?: (sessionId: string) => void;
}

export class ProcessManager {
  private agents = new Map<string, AgentProcess>();
  private client: ApiClient;
  private callbacks: ProcessManagerCallbacks;
  private taskTimeoutMs: number;

  constructor(client: ApiClient, callbacks: ProcessManagerCallbacks, taskTimeoutMs = 2 * 60 * 60 * 1000) {
    this.client = client;
    this.callbacks = callbacks;
    this.taskTimeoutMs = taskTimeoutMs;
  }

  get activeCount(): number {
    return this.agents.size;
  }

  hasTask(taskId: string): boolean {
    return this.agents.has(taskId);
  }

  getActiveTaskIds(): string[] {
    return [...this.agents.keys()];
  }

  async spawnAgent(req: SpawnRequest): Promise<void> {
    const { provider, taskId, sessionId, taskContext, agentClient, agentEnv } = req;
    const args = req.resume
      ? provider.buildResumeArgs(sessionId, req.model)
      : provider.buildArgs({ sessionId, systemPromptFile: req.systemPromptFile, model: req.model });

    let proc: ChildProcess;
    try {
      proc = spawn(provider.command, args, {
        cwd: req.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...agentEnv },
      });
    } catch (err: any) {
      logger.error(`Failed to spawn ${provider.command}: ${err.message}`);
      await this.releaseTask(taskId);
      return;
    }

    if (!proc.pid) {
      logger.error(`${provider.command} not found or failed to start`);
      await this.releaseTask(taskId);
      return;
    }

    const agent: AgentProcess = {
      taskId,
      sessionId,
      process: proc,
      provider,
      agentClient,
      onCleanup: req.onCleanup,
    };
    this.agents.set(taskId, agent);
    this.callbacks.onProcessStarted?.(sessionId, proc.pid);

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        logger.warn(`Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        this.terminateProcess(proc);
      }, this.taskTimeoutMs);
    }

    proc.on("spawn", () => {
      if (taskContext) proc.stdin?.write(`${provider.buildInput(taskContext)}\n`);
      proc.stdin?.end();
    });

    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = provider.parseEvent(line);
        if (event) this.handleEvent(taskId, event, agentClient).catch((e) => logger.error(`Event error/${taskId}: ${e.message}`));
      }
    });

    let stderrBuffer = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 50000) stderrBuffer = stderrBuffer.slice(-25000);
    });

    proc.on("close", (code) => {
      this.onClose(agent, code, stdoutBuffer, stderrBuffer).catch((e) => logger.error(`Close error/${taskId}: ${e.message}`));
    });

    proc.on("error", (err) => {
      this.onError(agent, err).catch((e) => logger.error(`Error handler/${taskId}: ${e.message}`));
    });

    logger.info(`Spawned ${provider.command} (session=${sessionId}) for task ${taskId} in ${req.cwd}`);
  }

  async killTask(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    logger.info(`Killing agent for cancelled task ${taskId}`);
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    this.agents.delete(taskId);
    await this.terminateProcess(agent.process);
    this.safeCleanup(agent);
    removeSession(agent.sessionId);
    await this.client
      .closeSession(agent.agentClient.getAgentId(), agent.sessionId)
      .catch((err: any) => logger.warn(`Failed to close session for cancelled task ${taskId}: ${err.message}`));
    this.callbacks.onSlotFreed();
  }

  async killAll(): Promise<void> {
    const entries = [...this.agents.entries()];
    for (const [taskId, agent] of entries) {
      logger.info(`Killing agent for task ${taskId}`);
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      this.agents.delete(taskId);
      await this.terminateProcess(agent.process);
      this.safeCleanup(agent);
      removeSession(agent.sessionId);
      await this.closeSession(agent.agentClient);
      await this.releaseTask(taskId);
    }
  }

  private async onClose(agent: AgentProcess, code: number | null, stdoutBuffer: string, stderrBuffer: string): Promise<void> {
    const { taskId, sessionId, agentClient } = agent;
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    cleanupPromptFile(sessionId);
    this.callbacks.onProcessExited?.(sessionId);

    // Already removed by killTask() — process was intentionally terminated
    if (!this.agents.has(taskId)) return;

    try {
      if (stdoutBuffer.trim()) {
        const event = agent.provider.parseEvent(stdoutBuffer);
        if (event) await this.handleEvent(taskId, event, agentClient);
      }

      this.agents.delete(taskId);
      await this.closeSession(agentClient);

      if (agent.resultReceived) {
        // handleEvent already updated session status — nothing to do
      } else if (code === 0) {
        // No result event but clean exit — check task status as fallback
        const task = (await this.client.getTask(taskId)) as any;
        if (task?.status === "in_review") {
          updateSession(sessionId, { status: "in_review" });
          logger.info(`Task ${taskId} in review, preserving worktree`);
        } else {
          logger.info(`Agent finished task ${taskId}`);
          this.safeCleanup(agent);
          removeSession(sessionId);
        }
      } else if (agent.rateLimited) {
        logger.warn(`Agent for task ${taskId} (${agent.provider.name}) exited due to rate limit, suspending`);
        updateSession(sessionId, { status: "rate_limited" });
      } else {
        logger.warn(`Agent crashed on task ${taskId} (${agent.provider.name}, exit ${code})`);
        if (stderrBuffer.trim()) {
          const lastLines = stderrBuffer.trim().split("\n").slice(-10).join("\n");
          logger.warn(`stderr: ${lastLines}`);
        }
        await this.releaseTask(taskId);
        this.safeCleanup(agent);
        removeSession(sessionId);
      }
    } finally {
      this.agents.delete(taskId); // idempotent — ensure removed even on error
      this.callbacks.onSlotFreed();
    }
  }

  private async onError(agent: AgentProcess, err: Error): Promise<void> {
    const { taskId, agentClient } = agent;
    if (!this.agents.has(taskId)) return;
    logger.error(`Agent process error for task ${taskId}: ${err.message}`);
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    this.agents.delete(taskId);
    this.safeCleanup(agent);
    removeSession(agent.sessionId);
    await this.closeSession(agentClient);
    await this.releaseTask(taskId);
    this.callbacks.onSlotFreed();
  }

  private async handleEvent(taskId: string, event: AgentEvent, agentClient: AgentClient): Promise<void> {
    switch (event.type) {
      case "rate_limit": {
        const agent = this.agents.get(taskId);
        const runtime = agent?.provider.name ?? "unknown";
        logger.warn(`Rate limited on task ${taskId} (${runtime}), resets at ${event.resetAt}`);
        if (agent) agent.rateLimited = true;
        this.callbacks.onRateLimited(runtime, event.resetAt);
        break;
      }

      case "error": {
        const agent = this.agents.get(taskId);
        logger.warn(`Agent error on task ${taskId} (${agent?.provider.name}): ${event.detail}`);
        break;
      }

      case "message": {
        agentClient
          .sendMessage(taskId, {
            sender_type: "agent",
            sender_id: agentClient.getAgentId(),
            content: event.text,
          })
          .catch((e: any) => logger.error(`Failed to send message for task ${taskId}: ${e.message}`));
        break;
      }

      case "result": {
        const cost = event.cost || 0;
        const usage = event.usage || {};
        const agent = this.agents.get(taskId);
        logger.info(`Agent result for task ${taskId} (${agent?.provider.name}): cost=$${cost.toFixed(4)}`);
        agentClient
          .updateSessionUsage(agentClient.getAgentId(), agentClient.getSessionId(), {
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
            cache_read_tokens: usage.cache_read_input_tokens || 0,
            cache_creation_tokens: usage.cache_creation_input_tokens || 0,
            cost_micro_usd: Math.round(cost * 1_000_000),
          })
          .catch((e: any) => logger.error(`Failed to report usage for task ${taskId}: ${e.message}`));
        if (agent) {
          agent.resultReceived = true;
          // Rate limit was transient — agent completed despite the warning
          if (agent.rateLimited) {
            this.callbacks.onRateLimitCleared?.(agent.provider.name);
          }
          const task = (await this.client.getTask(taskId)) as any;
          if (task?.status === "in_review") {
            updateSession(agent.sessionId, { status: "in_review" });
            logger.info(`Task ${taskId} in review, preserving worktree`);
          }
          this.terminateProcess(agent.process);
        }
        break;
      }
    }
  }

  private safeCleanup(agent: AgentProcess): void {
    try {
      agent.onCleanup?.();
    } catch (err: any) {
      logger.warn(`Cleanup failed for task ${agent.taskId}: ${err.message}`);
    }
  }

  private async closeSession(agentClient: AgentClient): Promise<void> {
    await this.client
      .closeSession(agentClient.getAgentId(), agentClient.getSessionId())
      .catch((err: any) => logger.warn(`Failed to close session ${agentClient.getSessionId()}: ${err.message}`));
  }

  private terminateProcess(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!proc.pid || proc.killed) {
        resolve();
        return;
      }

      const onExit = () => {
        clearTimeout(killTimer);
        resolve();
      };
      proc.once("close", onExit);
      proc.kill("SIGTERM");

      const killTimer = setTimeout(() => {
        proc.removeListener("close", onExit);
        if (!proc.killed) proc.kill("SIGKILL");
        resolve();
      }, 5000);
    });
  }

  private async releaseTask(taskId: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.client.releaseTask(taskId);
        return;
      } catch (err: any) {
        logger.warn(`Failed to release task ${taskId} (attempt ${i + 1}/${retries}): ${err.message}`);
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    logger.error(`Could not release task ${taskId} after ${retries} attempts. Task will remain locked until stale detection.`);
  }
}
