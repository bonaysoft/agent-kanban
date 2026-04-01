import type { AgentClient, ApiClient } from "./client.js";
import { createLogger } from "./logger.js";
import type { AgentEvent, AgentHandle, AgentProvider } from "./providers/types.js";
import { removeSession, updateSession } from "./sessionStore.js";
import { cleanupPromptFile } from "./systemPrompt.js";

const logger = createLogger("process");

// Agent Process Lifecycle:
//   EXECUTE → provider returns AgentHandle → RUNNING
//     for await (event of handle.events) → handleEvent
//   COMPLETE (iterator done) → check status → cleanup
//   ERROR (iterator throws) → release task → cleanup
//   ABORT (timeout/kill) → handle.abort() → cleanup

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
  handle: AgentHandle;
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
    const { provider, taskId, sessionId, agentClient } = req;

    let handle: AgentHandle;
    try {
      handle = await provider.execute({
        sessionId,
        cwd: req.cwd,
        env: { ...(process.env as Record<string, string>), ...req.agentEnv },
        taskContext: req.taskContext,
        systemPromptFile: req.systemPromptFile,
        model: req.model,
        resume: req.resume,
      });
    } catch (err: any) {
      logger.error(`Failed to execute ${provider.name}: ${err.message}`);
      await this.releaseTask(taskId);
      return;
    }

    const agent: AgentProcess = {
      taskId,
      sessionId,
      handle,
      provider,
      agentClient,
      onCleanup: req.onCleanup,
    };
    this.agents.set(taskId, agent);

    if (handle.pid) {
      this.callbacks.onProcessStarted?.(sessionId, handle.pid);
    }

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        logger.warn(`Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        handle.abort();
      }, this.taskTimeoutMs);
    }

    logger.info(`Started ${provider.name} (session=${sessionId}) for task ${taskId} in ${req.cwd}`);

    this.consumeEvents(agent).catch((e) => logger.error(`Event loop error/${taskId}: ${e.message}`));
  }

  async sendToAgent(taskId: string, message: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    await agent.handle.send(message);
  }

  async killTask(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    logger.info(`Killing agent for cancelled task ${taskId}`);
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    this.agents.delete(taskId);
    await agent.handle.abort();
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
      await agent.handle.abort();
      this.safeCleanup(agent);
      removeSession(agent.sessionId);
      await this.closeSession(agent.agentClient);
      await this.releaseTask(taskId);
    }
  }

  private async consumeEvents(agent: AgentProcess): Promise<void> {
    const { taskId, agentClient } = agent;

    try {
      for await (const event of agent.handle.events) {
        // Already removed by killTask() — process was intentionally terminated
        if (!this.agents.has(taskId)) return;
        await this.handleEvent(taskId, event, agentClient);
      }

      // Iterator done — agent finished
      await this.onComplete(agent);
    } catch (err: any) {
      await this.onCrash(agent, err);
    }
  }

  private async onComplete(agent: AgentProcess): Promise<void> {
    const { taskId, sessionId } = agent;
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    cleanupPromptFile(sessionId);
    this.callbacks.onProcessExited?.(sessionId);

    if (!this.agents.has(taskId)) return;

    try {
      this.agents.delete(taskId);
      await this.closeSession(agent.agentClient);

      if (agent.resultReceived) {
        if (agent.rateLimited) {
          logger.warn(`Agent for task ${taskId} (${agent.provider.name}) hit usage limit (cost=$0), suspending`);
          updateSession(sessionId, { status: "rate_limited" });
        }
      } else {
        const task = (await this.client.getTask(taskId)) as any;
        if (task?.status === "in_review") {
          updateSession(sessionId, { status: "in_review" });
          logger.info(`Task ${taskId} in review, preserving worktree`);
        } else if (agent.rateLimited) {
          logger.warn(`Agent for task ${taskId} (${agent.provider.name}) exited due to rate limit, suspending`);
          updateSession(sessionId, { status: "rate_limited" });
        } else {
          logger.info(`Agent finished task ${taskId}`);
          this.safeCleanup(agent);
          removeSession(sessionId);
        }
      }
    } finally {
      this.agents.delete(taskId);
      this.callbacks.onSlotFreed();
    }
  }

  private async onCrash(agent: AgentProcess, err: Error): Promise<void> {
    const { taskId, sessionId } = agent;
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    cleanupPromptFile(sessionId);
    this.callbacks.onProcessExited?.(sessionId);

    if (!this.agents.has(taskId)) return;

    try {
      this.agents.delete(taskId);
      await this.closeSession(agent.agentClient);

      if (agent.rateLimited) {
        logger.warn(`Agent for task ${taskId} (${agent.provider.name}) exited due to rate limit, suspending`);
        updateSession(sessionId, { status: "rate_limited" });
      } else {
        const exitCode = (err as any).exitCode;
        const stderr = (err as any).stderr || "";
        logger.warn(`Agent crashed on task ${taskId} (${agent.provider.name}, exit ${exitCode ?? "?"})`);
        if (stderr) logger.warn(`stderr: ${stderr}`);
        await this.releaseTask(taskId);
        this.safeCleanup(agent);
        removeSession(sessionId);
      }
    } finally {
      this.agents.delete(taskId);
      this.callbacks.onSlotFreed();
    }
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
          if (agent.rateLimited && cost > 0) {
            this.callbacks.onRateLimitCleared?.(agent.provider.name);
          }
          const task = (await this.client.getTask(taskId)) as any;
          if (task?.status === "in_review") {
            updateSession(agent.sessionId, { status: "in_review" });
            logger.info(`Task ${taskId} in review, preserving worktree`);
          }
          agent.handle.abort();
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
