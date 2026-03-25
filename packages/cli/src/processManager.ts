import { type ChildProcess, spawn } from "node:child_process";
import type { AgentClient, ApiClient } from "./client.js";
import { createLogger } from "./logger.js";
import type { AgentEvent, AgentProvider } from "./providers/types.js";
import { saveReviewSession } from "./reviewSessions.js";
import { cleanupPromptFile } from "./systemPrompt.js";

const logger = createLogger("process");

// Agent Process Lifecycle:
//   SPAWN → stdin task notification → RUNNING
//     agent claims task via CLI, works, completes via CLI
//     stdout (stream-json) → parse events → POST /messages
//   EXIT(0) → log success → cleanup
//   EXIT(N) → POST /release (crash recovery) → cleanup
//   KILL (shutdown) → POST /release → cleanup

export interface SuspendedSession {
  taskId: string;
  sessionId: string;
  cwd: string;
  repoDir: string;
  branchName: string;
  agentId: string;
  privateKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
  provider: AgentProvider;
  model?: string;
}

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  cwd: string;
  repoDir: string;
  branchName: string;
  process: ChildProcess;
  provider: AgentProvider;
  agentClient: AgentClient;
  privateKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  rateLimited?: boolean;
  resultReceived?: boolean;
  onCleanup?: () => void;
}

export interface ProcessManagerCallbacks {
  onSlotFreed: () => void;
  onRateLimited: (resetAt: string) => void;
  onProcessStarted?: (sessionId: string, pid: number) => void;
  onProcessExited?: (sessionId: string) => void;
}

export class ProcessManager {
  private agents = new Map<string, AgentProcess>();
  private suspended: SuspendedSession[] = [];
  private client: ApiClient;
  private onSlotFreed: () => void;
  private onRateLimited: (resetAt: string) => void;
  private onProcessStarted?: (sessionId: string, pid: number) => void;
  private onProcessExited?: (sessionId: string) => void;
  private taskTimeoutMs: number;

  constructor(client: ApiClient, callbacks: ProcessManagerCallbacks, taskTimeoutMs = 2 * 60 * 60 * 1000) {
    this.client = client;
    this.onSlotFreed = callbacks.onSlotFreed;
    this.onRateLimited = callbacks.onRateLimited;
    this.onProcessStarted = callbacks.onProcessStarted;
    this.onProcessExited = callbacks.onProcessExited;
    this.taskTimeoutMs = taskTimeoutMs;
  }

  get activeCount(): number {
    return this.agents.size;
  }

  hasTask(taskId: string): boolean {
    return this.agents.has(taskId);
  }

  async spawnAgent(
    provider: AgentProvider,
    taskId: string,
    sessionId: string,
    cwd: string,
    repoDir: string,
    branchName: string,
    taskContext: string,
    agentClient: AgentClient,
    agentEnv: Record<string, string>,
    privateKey: CryptoKey,
    privateKeyJwk: JsonWebKey,
    systemPromptFile?: string,
    resume?: boolean,
    onCleanup?: () => void,
    model?: string,
  ): Promise<void> {
    const args = resume ? provider.buildResumeArgs(sessionId, model) : provider.buildArgs({ sessionId, systemPromptFile, model });

    let proc: ChildProcess;
    try {
      proc = spawn(provider.command, args, {
        cwd,
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
      cwd,
      repoDir,
      branchName,
      process: proc,
      provider,
      agentClient,
      privateKey,
      privateKeyJwk,
      onCleanup,
    };
    this.agents.set(taskId, agent);
    this.onProcessStarted?.(sessionId, proc.pid);

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        logger.warn(`Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        this.terminateProcess(proc);
      }, this.taskTimeoutMs);
    }

    proc.on("spawn", () => {
      if (taskContext) {
        proc.stdin?.write(`${provider.buildInput(taskContext)}\n`);
      }
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
        if (event) this.handleEvent(taskId, sessionId, event, agentClient);
      }
    });

    let stderrBuffer = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 50000) stderrBuffer = stderrBuffer.slice(-25000);
    });

    proc.on("close", async (code) => {
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      cleanupPromptFile(sessionId);
      this.onProcessExited?.(sessionId);

      // Already removed by killTask() — process was intentionally terminated
      if (!this.agents.has(taskId)) return;

      if (stdoutBuffer.trim()) {
        const event = agent.provider.parseEvent(stdoutBuffer);
        if (event) this.handleEvent(taskId, sessionId, event, agentClient);
      }

      this.agents.delete(taskId);

      await this.closeSession(agentClient);

      if (agent.resultReceived || code === 0) {
        // Agent finished normally — check if worktree should be preserved
        const task = (await this.client.getTask(taskId)) as any;
        if (task?.status === "in_review") {
          // Already saved by result event handler, or save now as fallback
          if (!agent.resultReceived) {
            saveReviewSession({
              taskId,
              sessionId,
              cwd: agent.cwd,
              repoDir: agent.repoDir,
              branchName: agent.branchName,
              agentId: agentClient.getAgentId(),
              privateKeyJwk: agent.privateKeyJwk,
            });
            logger.info(`Task ${taskId} in review, preserving worktree`);
          }
        } else {
          logger.info(`Agent finished task ${taskId}`);
          agent.onCleanup?.();
        }
      } else if (agent.rateLimited) {
        logger.warn(`Agent for task ${taskId} exited due to rate limit, suspending`);
        this.suspended.push({
          taskId,
          sessionId,
          cwd: agent.cwd,
          repoDir: agent.repoDir,
          branchName: agent.branchName,
          agentId: agentClient.getAgentId(),
          privateKey: agent.privateKey,
          privateKeyJwk: agent.privateKeyJwk,
          provider: agent.provider,
        });
      } else {
        logger.warn(`Agent crashed on task ${taskId} (exit ${code})`);
        if (stderrBuffer.trim()) {
          const lastLines = stderrBuffer.trim().split("\n").slice(-10).join("\n");
          logger.warn(`stderr: ${lastLines}`);
        }
        await this.releaseTask(taskId);
        agent.onCleanup?.();
      }

      this.onSlotFreed();
    });

    proc.on("error", async (err) => {
      if (!this.agents.has(taskId)) return;
      logger.error(`Agent process error for task ${taskId}: ${err.message}`);
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      this.agents.delete(taskId);
      agent.onCleanup?.();
      await this.closeSession(agentClient);
      await this.releaseTask(taskId);
      this.onSlotFreed();
    });

    logger.info(`Spawned ${provider.command} (session=${sessionId}) for task ${taskId} in ${cwd}`);
  }

  async killTask(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    logger.info(`Killing agent for cancelled task ${taskId}`);
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    this.agents.delete(taskId);
    await this.terminateProcess(agent.process);
    agent.onCleanup?.();
    await this.client
      .closeSession(agent.agentClient.getAgentId(), agent.sessionId)
      .catch((err: any) => logger.warn(`Failed to close session for cancelled task ${taskId}: ${err.message}`));
    this.onSlotFreed();
  }

  getActiveTaskIds(): string[] {
    return [...this.agents.keys()];
  }

  getSuspended(): SuspendedSession[] {
    return this.suspended;
  }

  clearSuspended(): void {
    this.suspended = [];
  }

  async killAll(): Promise<void> {
    const entries = [...this.agents.entries()];
    for (const [taskId, agent] of entries) {
      logger.info(`Killing agent for task ${taskId}`);
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      this.agents.delete(taskId);
      await this.terminateProcess(agent.process);
      agent.onCleanup?.();
      await this.closeSession(agent.agentClient);
      await this.releaseTask(taskId);
    }
  }

  private async handleEvent(taskId: string, sessionId: string, event: AgentEvent, agentClient: AgentClient): Promise<void> {
    switch (event.type) {
      case "rate_limit": {
        logger.warn(`Rate limited on task ${taskId}, resets at ${event.resetAt}`);
        const agent = this.agents.get(taskId);
        if (agent) agent.rateLimited = true;
        this.onRateLimited(event.resetAt);
        break;
      }

      case "error": {
        logger.warn(`Agent error on task ${taskId}: ${event.detail}`);
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
        logger.info(`Agent result for task ${taskId}: cost=$${cost.toFixed(4)}`);
        agentClient
          .updateSessionUsage(agentClient.getAgentId(), agentClient.getSessionId(), {
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
            cache_read_tokens: usage.cache_read_input_tokens || 0,
            cache_creation_tokens: usage.cache_creation_input_tokens || 0,
            cost_micro_usd: Math.round(cost * 1_000_000),
          })
          .catch((e: any) => logger.error(`Failed to report usage for task ${taskId}: ${e.message}`));

        // Agent is done — save review session if needed, then kill process
        const agent = this.agents.get(taskId);
        if (agent) {
          agent.resultReceived = true;
          const task = (await this.client.getTask(taskId)) as any;
          if (task?.status === "in_review") {
            saveReviewSession({
              taskId,
              sessionId,
              cwd: agent.cwd,
              repoDir: agent.repoDir,
              branchName: agent.branchName,
              agentId: agentClient.getAgentId(),
              privateKeyJwk: agent.privateKeyJwk,
            });
            logger.info(`Task ${taskId} in review, preserving worktree`);
          }
          this.terminateProcess(agent.process);
        }
        break;
      }
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
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
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
