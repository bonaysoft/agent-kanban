/**
 * RuntimePool — registry of live agent handles.
 *
 * Manages the in-memory Map of active AgentProcess records. Delegates
 * per-agent lifecycle to agentRuntime functions. The only structural
 * try/finally in the module guarantees onSlotFreed fires after finalize.
 */

import type { AgentClient, ApiClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import type { AgentHandle, AgentProvider } from "../providers/types.js";
import { type AgentProcess, consumeEvents, finalize, finalizeCancelled, type RuntimeContext } from "./agentRuntime.js";
import { apiFireAndForget, providerExecute } from "./boundaries.js";
import type { RateLimitSink, TunnelSink } from "./eventRouter.js";

const logger = createLogger("runtime-pool");

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

export interface PoolCallbacks {
  onSlotFreed: () => void;
}

export class RuntimePool {
  private agents = new Map<string, AgentProcess>();
  private client: ApiClient;
  private callbacks: PoolCallbacks;
  private taskTimeoutMs: number;
  private rateLimitSink: RateLimitSink;
  private tunnel: (TunnelSink & { sendStatus?(sid: string, s: string): void }) | null;

  constructor(
    client: ApiClient,
    callbacks: PoolCallbacks,
    rateLimitSink: RateLimitSink,
    taskTimeoutMs = 2 * 60 * 60 * 1000,
    tunnel?: TunnelSink | null,
  ) {
    this.client = client;
    this.callbacks = callbacks;
    this.rateLimitSink = rateLimitSink;
    this.taskTimeoutMs = taskTimeoutMs;
    this.tunnel = tunnel ?? null;
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

    const handle: AgentHandle = await providerExecute(provider.name, () =>
      provider.execute({
        sessionId,
        cwd: req.cwd,
        env: { ...(process.env as Record<string, string>), ...req.agentEnv },
        taskContext: req.taskContext,
        systemPromptFile: req.systemPromptFile,
        model: req.model,
        resume: req.resume,
      }),
    );

    const agent: AgentProcess = {
      taskId,
      sessionId,
      handle,
      providerName: provider.name,
      agentClient,
      rateLimited: false,
      resultReceived: false,
      taskInReview: false,
      onCleanup: req.onCleanup,
    };
    this.agents.set(taskId, agent);

    this.tunnel?.sendStatus?.(sessionId, "working");

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        logger.warn(`Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        agent.handle.abort().catch((e) => logger.warn(`Abort during timeout failed: ${errMessage(e)}`));
      }, this.taskTimeoutMs);
    }

    logger.info(`Started ${provider.name} (session=${sessionId}) for task ${taskId} in ${req.cwd}`);

    this.runEventLoop(agent);
  }

  async sendToAgent(taskId: string, message: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    await agent.handle.send(message);
  }

  async sendToSession(sessionId: string, message: string): Promise<boolean> {
    for (const agent of this.agents.values()) {
      if (agent.sessionId === sessionId) {
        await agent.handle.send(message);
        return true;
      }
    }
    return false;
  }

  async killTask(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    logger.info(`Killing agent for cancelled task ${taskId}`);
    this.agents.delete(taskId);
    await agent.handle.abort().catch((e) => logger.warn(`Abort failed: ${errMessage(e)}`));
    await finalizeCancelled(agent, this.runtimeCtx());
    this.callbacks.onSlotFreed();
  }

  async killAll(): Promise<void> {
    const entries = [...this.agents.entries()];
    for (const [taskId, agent] of entries) {
      logger.info(`Killing agent for task ${taskId}`);
      this.agents.delete(taskId);
      await agent.handle.abort().catch((e) => logger.warn(`Abort failed: ${errMessage(e)}`));
      apiFireAndForget(
        "closeSession",
        () => this.client.closeSession(agent.agentClient.getAgentId(), agent.agentClient.getSessionId()),
        (msg) => logger.warn(`Failed to close session ${agent.sessionId}: ${msg}`),
      );
      apiFireAndForget(
        "releaseTask",
        () => this.client.releaseTask(taskId),
        (msg) => logger.warn(`Failed to release task ${taskId}: ${msg}`),
      );
    }
  }

  private runEventLoop(agent: AgentProcess): void {
    const ctx = this.runtimeCtx();
    const loop = async () => {
      let result: { crashed: boolean; error?: unknown };
      try {
        result = await consumeEvents(agent, ctx);
      } catch (err) {
        result = { crashed: true, error: err };
      }
      if (!this.agents.has(agent.taskId)) return; // killTask ran
      this.agents.delete(agent.taskId);
      try {
        await finalize(agent, result, ctx);
      } finally {
        this.callbacks.onSlotFreed();
      }
    };
    loop().catch((e) => logger.error(`Event loop error/${agent.taskId}: ${errMessage(e)}`));
  }

  private runtimeCtx(): RuntimeContext {
    return {
      client: this.client,
      rateLimitSink: this.rateLimitSink,
      tunnel: this.tunnel,
      isAlive: (taskId) => this.agents.has(taskId),
    };
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
