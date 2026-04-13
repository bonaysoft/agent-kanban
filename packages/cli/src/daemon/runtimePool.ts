/**
 * RuntimePool — registry of live agent handles, event routing, and per-agent lifecycle.
 *
 * Manages the in-memory Map of active AgentProcess records. Routes events from
 * the agent provider to archival/rate-limit/turn-end handlers. Drives post-iterator
 * finalization through the session state machine.
 */

import { cleanupPromptFile } from "../agent/systemPrompt.js";
import type { AgentClient, ApiClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentHandle, AgentProvider } from "../providers/types.js";
import { getSessionManager } from "../session/manager.js";
import { classifyIteratorEnd, type SessionEvent } from "../session/stateMachine.js";
import { apiCallOptional, apiFireAndForget, providerExecute } from "./boundaries.js";
import { classify } from "./errors.js";

const logger = createLogger("runtime-pool");

// ---- Types ----

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  handle: AgentHandle;
  providerName: string;
  agentClient: AgentClient;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  rateLimited: boolean;
  resultReceived: boolean;
  taskInReview: boolean;
  onCleanup?: () => void;
}

export interface RuntimeContext {
  client: ApiClient;
  rateLimitSink: RateLimitSink;
  tunnel: TunnelSink | null;
  isAlive: (taskId: string) => boolean;
}

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

export interface AgentFlags {
  taskId: string;
  sessionId: string;
  providerName: string;
  rateLimited: boolean;
  resultReceived: boolean;
  taskInReview: boolean;
  handle: { abort(): Promise<void> };
}

export interface RateLimitSink {
  onRateLimited: (runtime: string, resetAt: string) => void;
  onRateLimitResumed: (runtime: string) => void;
}

export interface TunnelSink {
  sendEvent(sessionId: string, event: AgentEvent): void;
}

// ---- RuntimePool class ----

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

// ---- Event routing ----

async function routeEvent(
  agent: AgentFlags,
  event: AgentEvent,
  agentClient: AgentClient,
  rateLimitSink: RateLimitSink,
  tunnel: TunnelSink | null,
): Promise<void> {
  tunnel?.sendEvent(agent.sessionId, event);

  switch (event.type) {
    case "turn.rate_limit":
      routeRateLimit(agent, event, rateLimitSink);
      return;
    case "turn.error":
      logger.warn(`Agent error on task ${agent.taskId} (${agent.providerName}): ${event.detail}`);
      return;
    case "message":
      archiveMessage(agentClient, agent.taskId, event);
      return;
    case "block.done":
      archiveBlock(agentClient, agent.taskId, event);
      return;
    case "turn.end":
      await routeTurnEnd(agent, event, agentClient);
      return;
    default:
      return;
  }
}

function routeRateLimit(agent: AgentFlags, event: Extract<AgentEvent, { type: "turn.rate_limit" }>, sink: RateLimitSink): void {
  const runtime = agent.providerName;
  if (event.status === "rejected") {
    const mainReset = event.resetAt;
    const overageReset = event.overage?.status === "rejected" ? event.overage.resetAt : undefined;
    const candidates = [mainReset, overageReset].filter((x): x is string => !!x);
    const pauseUntil =
      candidates.length > 0
        ? candidates.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    logger.warn(
      `Rate limited on task ${agent.taskId} (${runtime}), pausing until ${pauseUntil}${event.isUsingOverage ? " — agent continues via overage" : ""}`,
    );
    agent.rateLimited = true;
    sink.onRateLimited(runtime, pauseUntil);
    return;
  }
  if (event.isUsingOverage) {
    logger.info(`Task ${agent.taskId} (${runtime}) now running on overage, scheduler stays paused`);
    return;
  }
  logger.info(`Rate limit cleared for ${runtime}`);
  agent.rateLimited = false;
  sink.onRateLimitResumed(runtime);
}

async function routeTurnEnd(agent: AgentFlags, event: Extract<AgentEvent, { type: "turn.end" }>, agentClient: AgentClient): Promise<void> {
  const cost = event.cost || 0;
  const usage = event.usage || {};
  logger.info(`Agent result for task ${agent.taskId} (${agent.providerName}): cost=$${cost.toFixed(4)}`);

  apiFireAndForget(
    "updateSessionUsage",
    () =>
      agentClient.updateSessionUsage(agentClient.getAgentId(), agentClient.getSessionId(), {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_micro_usd: Math.round(cost * 1_000_000),
      }),
    (msg) => logger.error(`Failed to report usage for task ${agent.taskId}: ${msg}`),
  );

  agent.resultReceived = true;

  const task = (await apiCallOptional("getTask", () => agentClient.getTask(agent.taskId))) as { status?: string } | null;
  agent.taskInReview = task?.status === "in_review";
  if (agent.taskInReview) {
    logger.info(`Task ${agent.taskId} will preserve worktree for review`);
  }

  apiFireAndForget(
    "abort-after-result",
    () => agent.handle.abort(),
    (msg) => logger.warn(`Abort after result failed: ${msg}`),
  );
}

function archiveMessage(agentClient: AgentClient, taskId: string, event: Extract<AgentEvent, { type: "message" }>): void {
  const texts = event.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
  if (texts.length === 0) return;
  apiFireAndForget(
    "sendMessage",
    () => agentClient.sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: texts.join("\n") }),
    (msg) => logger.error(`Failed to send message for task ${taskId}: ${msg}`),
  );
}

function archiveBlock(agentClient: AgentClient, taskId: string, event: Extract<AgentEvent, { type: "block.done" }>): void {
  const block = event.block;
  if (block.type !== "text" || !block.text) return;
  const text = block.text;
  apiFireAndForget(
    "sendMessage",
    () => agentClient.sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: text }),
    (msg) => logger.error(`Failed to send message for task ${taskId}: ${msg}`),
  );
}

// ---- Agent lifecycle ----

async function consumeEvents(agent: AgentProcess, ctx: RuntimeContext): Promise<{ crashed: boolean; error?: unknown }> {
  const flags: AgentFlags = {
    taskId: agent.taskId,
    sessionId: agent.sessionId,
    providerName: agent.providerName,
    rateLimited: agent.rateLimited,
    resultReceived: agent.resultReceived,
    taskInReview: agent.taskInReview,
    handle: agent.handle,
  };

  try {
    for await (const event of agent.handle.events) {
      if (!ctx.isAlive(agent.taskId)) return { crashed: false };
      await routeEvent(flags, event, agent.agentClient, ctx.rateLimitSink, ctx.tunnel);
    }
    return { crashed: false };
  } catch (err) {
    return { crashed: true, error: err };
  } finally {
    // Always sync flags back so finalize() sees rate-limit / result state
    // even when the iterator throws (e.g. CLI exits with rate-limit error).
    agent.rateLimited = flags.rateLimited;
    agent.resultReceived = flags.resultReceived;
    agent.taskInReview = flags.taskInReview;
  }
}

async function finalize(agent: AgentProcess, opts: { crashed: boolean; error?: unknown }, ctx: RuntimeContext): Promise<void> {
  const { taskId, sessionId } = agent;
  const sessions = getSessionManager();

  clearTimer(agent);
  cleanupPromptFile(sessionId);

  apiFireAndForget(
    "closeSession",
    () => ctx.client.closeSession(agent.agentClient.getAgentId(), sessionId),
    (msg) => logger.warn(`Failed to close session ${sessionId}: ${msg}`),
  );

  let transient = false;
  if (opts.crashed) {
    const err = opts.error as { exitCode?: number; stderr?: string; message?: string } | undefined;
    transient = classify(opts.error, "iterator").kind === "transient";
    if (transient) {
      logger.warn(`Agent hit transient error on task ${taskId} (${agent.providerName}): ${err?.message ?? ""}`);
    } else {
      logger.warn(`Agent crashed on task ${taskId} (${agent.providerName}, exit ${err?.exitCode ?? "?"}): ${err?.message ?? ""}`);
    }
    if (err?.stderr) logger.warn(`stderr: ${err.stderr}`);
  } else {
    logger.info(`Agent finished task ${taskId}`);
  }

  const event: SessionEvent = classifyIteratorEnd({
    resultReceived: agent.resultReceived,
    rateLimited: agent.rateLimited,
    taskInReview: agent.taskInReview,
    crashed: opts.crashed,
    transient,
  });

  const next = await sessions.applyEvent(sessionId, event).catch((e) => {
    logger.error(`State transition failed for ${sessionId}: ${errMessage(e)}`);
    return null;
  });

  const nextStatus = next?.status ?? "terminal";

  if (nextStatus === "completing") {
    if (opts.crashed) {
      apiFireAndForget(
        "releaseTask",
        () => ctx.client.releaseTask(taskId),
        (msg) => logger.warn(`Failed to release crashed task ${taskId}: ${msg}`),
      );
    }
    runCleanup(agent, ctx.tunnel);
    await sessions.applyEvent(sessionId, { type: "cleanup_done" }).catch((e) => {
      logger.warn(`Cleanup transition failed for ${sessionId}: ${errMessage(e)}`);
    });
  } else if (nextStatus === "in_review") {
    (ctx.tunnel as TunnelSink & { sendStatus?: (sid: string, s: string) => void })?.sendStatus?.(sessionId, "done");
    logger.info(`Task ${taskId} in review, preserving worktree`);
  } else if (nextStatus === "rate_limited") {
    if (transient) {
      const backoffMs = 30_000;
      await sessions.patch(sessionId, { resumeBackoffMs: backoffMs, resumeAfter: Date.now() + backoffMs }).catch(() => {});
      logger.warn(`Transient crash on task ${taskId}, suspending with ${backoffMs / 1000}s backoff`);
    } else {
      logger.warn(`Agent for task ${taskId} (${agent.providerName}) exited while rate-limited, suspending`);
    }
  }
}

async function finalizeCancelled(agent: AgentProcess, ctx: RuntimeContext): Promise<void> {
  const sessions = getSessionManager();
  cleanupPromptFile(agent.sessionId);

  await sessions.applyEvent(agent.sessionId, { type: "task_cancelled" }).catch((e) => {
    logger.warn(`task_cancelled transition failed for ${agent.sessionId}: ${errMessage(e)}`);
  });
  runCleanup(agent, ctx.tunnel);
  await sessions.applyEvent(agent.sessionId, { type: "cleanup_done" }).catch((e) => {
    logger.warn(`cleanup_done transition failed for ${agent.sessionId}: ${errMessage(e)}`);
  });
  apiFireAndForget(
    "closeSession",
    () => ctx.client.closeSession(agent.agentClient.getAgentId(), agent.sessionId),
    (msg) => logger.warn(`Failed to close session ${agent.sessionId}: ${msg}`),
  );
}

// ---- Helpers ----

function runCleanup(agent: AgentProcess, tunnel: TunnelSink | null): void {
  (tunnel as TunnelSink & { sendStatus?: (sid: string, s: string) => void })?.sendStatus?.(agent.sessionId, "done");
  agent.onCleanup?.();
}

function clearTimer(agent: AgentProcess): void {
  if (agent.timeoutTimer) {
    clearTimeout(agent.timeoutTimer);
    agent.timeoutTimer = undefined;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
