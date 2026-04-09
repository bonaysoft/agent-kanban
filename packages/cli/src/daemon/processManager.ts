/**
 * ProcessManager — in-memory registry of live AgentHandles.
 *
 * Despite the historical name, this no longer manages OS processes. Per-task
 * agents are either in-process async iterators (Claude SDK) or process-backed
 * iterators wrapped behind a uniform AgentHandle. The provider layer owns all
 * process concerns; ProcessManager only sees the handle contract.
 *
 * Lifecycle (single flow, no split brain):
 *   spawnAgent → agents.set → consumeEvents loop → finalize(flags)
 *   finalize:
 *     1. classify iterator end via the state machine
 *     2. SessionManager.applyEvent — state transition is atomic
 *     3. if the transition produced 'completing', run cleanup then fire
 *        cleanup_done which removes the file. If it produced 'in_review' or
 *        'rate_limited', the session file is preserved.
 *
 * This fixes the worktree-leak race: the state transition and the cleanup
 * decision are serialized through the SessionManager mutex. No sibling code
 * can observe an intermediate state.
 */

import { cleanupPromptFile } from "../agent/systemPrompt.js";
import type { AgentClient, ApiClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentHandle, AgentProvider } from "../providers/types.js";
import { getSessionManager } from "../session/manager.js";
import { classifyIteratorEnd, type SessionEvent } from "../session/stateMachine.js";
import type { TunnelClient } from "./tunnel.js";

const logger = createLogger("process");

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
  rateLimited: boolean;
  resultReceived: boolean;
  taskInReview: boolean;
  onCleanup?: () => void;
}

export interface ProcessManagerCallbacks {
  onSlotFreed: () => void;
  onRateLimited: (runtime: string, resetAt: string) => void;
  onRateLimitResumed: (runtime: string) => void;
}

export class ProcessManager {
  private agents = new Map<string, AgentProcess>();
  private sessions = getSessionManager();
  private client: ApiClient;
  private callbacks: ProcessManagerCallbacks;
  private taskTimeoutMs: number;
  private tunnel: TunnelClient | null;

  constructor(client: ApiClient, callbacks: ProcessManagerCallbacks, taskTimeoutMs = 2 * 60 * 60 * 1000, tunnel?: TunnelClient) {
    this.client = client;
    this.callbacks = callbacks;
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
    } catch (err) {
      logger.error(`Failed to execute ${provider.name}: ${errMessage(err)}`);
      await this.releaseTask(taskId);
      return;
    }

    const agent: AgentProcess = {
      taskId,
      sessionId,
      handle,
      provider,
      agentClient,
      rateLimited: false,
      resultReceived: false,
      taskInReview: false,
      onCleanup: req.onCleanup,
    };
    this.agents.set(taskId, agent);

    this.tunnel?.sendStatus(sessionId, "working");

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        logger.warn(`Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        handle.abort().catch((e) => logger.warn(`Abort during timeout failed: ${errMessage(e)}`));
      }, this.taskTimeoutMs);
    }

    logger.info(`Started ${provider.name} (session=${sessionId}) for task ${taskId} in ${req.cwd}`);

    this.consumeEvents(agent).catch((e) => logger.error(`Event loop error/${taskId}: ${errMessage(e)}`));
  }

  async sendToAgent(taskId: string, message: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    await agent.handle.send(message);
  }

  /** Send message to a running agent by sessionId. Returns true if delivered. */
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
    clearTimer(agent);
    this.agents.delete(taskId);
    await agent.handle.abort().catch((e) => logger.warn(`Abort failed: ${errMessage(e)}`));
    await this.finalizeCancelled(agent);
    this.callbacks.onSlotFreed();
  }

  async killAll(): Promise<void> {
    const entries = [...this.agents.entries()];
    for (const [taskId, agent] of entries) {
      logger.info(`Killing agent for task ${taskId}`);
      clearTimer(agent);
      this.agents.delete(taskId);
      await agent.handle.abort().catch((e) => logger.warn(`Abort failed: ${errMessage(e)}`));
      // Release task so someone can pick it up on restart. The session file is
      // left for OrphanReaper to resolve on next boot. No cleanup here —
      // daemon is shutting down, worktree cleanup is not urgent.
      await this.closeAgentSession(agent.agentClient);
      await this.releaseTask(taskId);
    }
  }

  // ---- Internal ----

  private async consumeEvents(agent: AgentProcess): Promise<void> {
    const { taskId, agentClient } = agent;

    try {
      for await (const event of agent.handle.events) {
        if (!this.agents.has(taskId)) return; // killTask ran
        await this.handleEvent(agent, event, agentClient);
      }
      await this.finalize(agent, { crashed: false });
    } catch (err) {
      await this.finalize(agent, { crashed: true, error: err });
    }
  }

  private async finalize(agent: AgentProcess, opts: { crashed: boolean; error?: unknown }): Promise<void> {
    const { taskId, sessionId } = agent;
    clearTimer(agent);
    cleanupPromptFile(sessionId);
    if (!this.agents.has(taskId)) return;
    this.agents.delete(taskId);

    try {
      await this.closeAgentSession(agent.agentClient);

      if (opts.crashed) {
        const err = opts.error as { exitCode?: number; stderr?: string; message?: string } | undefined;
        logger.warn(`Agent crashed on task ${taskId} (${agent.provider.name}, exit ${err?.exitCode ?? "?"}): ${err?.message ?? ""}`);
        if (err?.stderr) logger.warn(`stderr: ${err.stderr}`);
      } else {
        logger.info(`Agent finished task ${taskId}`);
      }

      const event: SessionEvent = classifyIteratorEnd({
        resultReceived: agent.resultReceived,
        rateLimited: agent.rateLimited,
        taskInReview: agent.taskInReview,
        crashed: opts.crashed,
      });

      const next = await this.sessions.applyEvent(sessionId, event).catch((e) => {
        logger.error(`State transition failed for ${sessionId}: ${errMessage(e)}`);
        return null;
      });

      const nextStatus = next?.status ?? "terminal";

      if (nextStatus === "completing") {
        // Normal completion: run cleanup, release task if crashed, then
        // transition to terminal (which removes the session file).
        if (opts.crashed) await this.releaseTask(taskId);
        this.runCleanup(agent);
        await this.sessions.applyEvent(sessionId, { type: "cleanup_done" }).catch((e) => {
          logger.warn(`Cleanup transition failed for ${sessionId}: ${errMessage(e)}`);
        });
      } else if (nextStatus === "in_review") {
        // Task is awaiting human review — preserve worktree, do NOT run cleanup.
        this.tunnel?.sendStatus(sessionId, "done");
        logger.info(`Task ${taskId} in review, preserving worktree`);
      } else if (nextStatus === "rate_limited") {
        // Agent exited while rate-limited without a result. Keep session for resume.
        logger.warn(`Agent for task ${taskId} (${agent.provider.name}) exited while rate-limited, suspending`);
      }
    } finally {
      this.callbacks.onSlotFreed();
    }
  }

  /**
   * Finalize path for killTask (cancelled by reviewer). Drives the session
   * straight to terminal via task_cancelled → cleanup_done.
   */
  private async finalizeCancelled(agent: AgentProcess): Promise<void> {
    cleanupPromptFile(agent.sessionId);
    try {
      await this.sessions.applyEvent(agent.sessionId, { type: "task_cancelled" }).catch((e) => {
        logger.warn(`task_cancelled transition failed for ${agent.sessionId}: ${errMessage(e)}`);
      });
      this.runCleanup(agent);
      await this.sessions.applyEvent(agent.sessionId, { type: "cleanup_done" }).catch((e) => {
        logger.warn(`cleanup_done transition failed for ${agent.sessionId}: ${errMessage(e)}`);
      });
      await this.closeAgentSession(agent.agentClient);
    } catch (e) {
      logger.warn(`finalizeCancelled error: ${errMessage(e)}`);
    }
  }

  private async handleEvent(agent: AgentProcess, event: AgentEvent, agentClient: AgentClient): Promise<void> {
    this.tunnel?.sendEvent(agent.sessionId, event);

    switch (event.type) {
      case "turn.rate_limit":
        this.handleRateLimit(agent, event);
        return;
      case "turn.error":
        logger.warn(`Agent error on task ${agent.taskId} (${agent.provider.name}): ${event.detail}`);
        return;
      case "message":
        this.archiveMessage(agentClient, agent.taskId, event);
        return;
      case "block.done":
        this.archiveBlock(agentClient, agent.taskId, event);
        return;
      case "turn.end":
        await this.handleTurnEnd(agent, event, agentClient);
        return;
      default:
        return;
    }
  }

  private handleRateLimit(agent: AgentProcess, event: Extract<AgentEvent, { type: "turn.rate_limit" }>): void {
    const runtime = agent.provider.name;
    if (event.status === "rejected") {
      // Pick the furthest-out known resetAt across main + overage. If none are
      // known we still have to pick something; one hour is the historical
      // default. Scheduler's pauseForRateLimit takes the max of any existing
      // pause so a short fallback never overwrites a long real reset.
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
      this.callbacks.onRateLimited(runtime, pauseUntil);
      return;
    }
    // status === "allowed"
    if (event.isUsingOverage) {
      logger.info(`Task ${agent.taskId} (${runtime}) now running on overage, scheduler stays paused`);
      // rateLimited flag stays true — main quota has NOT recovered.
      return;
    }
    logger.info(`Rate limit cleared for ${runtime}`);
    agent.rateLimited = false;
    this.callbacks.onRateLimitResumed(runtime);
  }

  private async handleTurnEnd(agent: AgentProcess, event: Extract<AgentEvent, { type: "turn.end" }>, agentClient: AgentClient): Promise<void> {
    const cost = event.cost || 0;
    const usage = event.usage || {};
    logger.info(`Agent result for task ${agent.taskId} (${agent.provider.name}): cost=$${cost.toFixed(4)}`);

    agentClient
      .updateSessionUsage(agentClient.getAgentId(), agentClient.getSessionId(), {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_micro_usd: Math.round(cost * 1_000_000),
      })
      .catch((e) => logger.error(`Failed to report usage for task ${agent.taskId}: ${errMessage(e)}`));

    agent.resultReceived = true;

    // Fetch task status so finalize() knows whether to preserve the worktree
    // (in_review) or clean it up. Transient failures here default taskInReview
    // to false — the worst case is a worktree leak that OrphanReaper fixes on
    // restart. We do NOT hide the error; we log it loudly.
    try {
      const task = (await this.client.getTask(agent.taskId)) as { status?: string } | null;
      agent.taskInReview = task?.status === "in_review";
      if (agent.taskInReview) {
        logger.info(`Task ${agent.taskId} will preserve worktree for review`);
      }
    } catch (e) {
      logger.warn(`Failed to fetch task ${agent.taskId} status after result: ${errMessage(e)}`);
    }

    await agent.handle.abort().catch((e) => logger.warn(`Abort after result failed: ${errMessage(e)}`));
  }

  private archiveMessage(agentClient: AgentClient, taskId: string, event: Extract<AgentEvent, { type: "message" }>): void {
    const texts = event.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    if (texts.length === 0) return;
    agentClient
      .sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: texts.join("\n") })
      .catch((e) => logger.error(`Failed to send message for task ${taskId}: ${errMessage(e)}`));
  }

  private archiveBlock(agentClient: AgentClient, taskId: string, event: Extract<AgentEvent, { type: "block.done" }>): void {
    if (event.block.type !== "text" || !event.block.text) return;
    agentClient
      .sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: event.block.text })
      .catch((e) => logger.error(`Failed to send message for task ${taskId}: ${errMessage(e)}`));
  }

  private runCleanup(agent: AgentProcess): void {
    this.tunnel?.sendStatus(agent.sessionId, "done");
    try {
      agent.onCleanup?.();
    } catch (err) {
      logger.warn(`Cleanup failed for task ${agent.taskId}: ${errMessage(err)}`);
    }
  }

  private async closeAgentSession(agentClient: AgentClient): Promise<void> {
    await this.client
      .closeSession(agentClient.getAgentId(), agentClient.getSessionId())
      .catch((err) => logger.warn(`Failed to close session ${agentClient.getSessionId()}: ${errMessage(err)}`));
  }

  private async releaseTask(taskId: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.client.releaseTask(taskId);
        return;
      } catch (err) {
        logger.warn(`Failed to release task ${taskId} (attempt ${i + 1}/${retries}): ${errMessage(err)}`);
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    logger.error(`Could not release task ${taskId} after ${retries} attempts. Task will remain locked until stale detection.`);
  }
}

// ---- Helpers ----

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
