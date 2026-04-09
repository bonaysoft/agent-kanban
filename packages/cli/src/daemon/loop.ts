/**
 * DaemonLoop — the tick orchestrator.
 *
 * Owns the setTimeout-based poll loop. Each tick runs ordered phases:
 * killCancelled -> reap -> reviewWatch -> resumeRateLimit -> dispatch.
 *
 * The ONLY catch in the whole daemon is at the setTimeout level:
 * tick().catch(handleTickError) — this is the top-level boundary.
 */

import { type ApiClient, ApiError } from "../client/index.js";
import { createLogger } from "../logger.js";
import { getSessionManager } from "../session/manager.js";
import { apiCallOptional } from "./boundaries.js";
import { dispatchTasks } from "./dispatcher.js";
import { reapCleanupPending, reapOrphanWorkerSessions } from "./orphanReaper.js";
import type { PrMonitor } from "./prMonitor.js";
import { type RateLimiter } from "./rateLimiter.js";
import { resumeOneSession, resumeSession } from "./resumer.js";
import { checkRejectedReviews } from "./reviewWatcher.js";
import type { RuntimePool } from "./runtimePool.js";

const logger = createLogger("loop");

export interface LoopOpts {
  maxConcurrent: number;
  pollInterval: number;
}

export class DaemonLoop {
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs: number;
  private sessions = getSessionManager();

  constructor(
    private client: ApiClient,
    private pool: RuntimePool,
    private rateLimiter: RateLimiter,
    private prMonitor: PrMonitor,
    private opts: LoopOpts,
  ) {
    this.backoffMs = opts.pollInterval;
  }

  start(): void {
    this.running = true;
    this.schedulePoll(0);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  onSlotFreed(): void {
    this.schedulePoll(this.opts.pollInterval);
  }

  /**
   * Resume rate-limited sessions for a runtime whose window just expired.
   * Called by RateLimiter's onResumed callback.
   */
  async resumeRateLimitedSessions(runtime: string): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    for (const s of this.sessions.list({ type: "worker", status: "rate_limited" })) {
      if (this.pool.activeCount >= this.opts.maxConcurrent) return;
      if (s.runtime !== runtime) continue;
      if (!s.taskId || this.pool.hasTask(s.taskId)) continue;
      if (s.resumeAfter && s.resumeAfter > now) continue;
      await resumeOneSession(s, "", this.client, this.pool);
    }
    this.schedulePoll(0);
  }

  private schedulePoll(delayMs: number): void {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.tick().catch((e) => this.handleTickError(e)), delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    await this.killCancelledTasks();
    await reapOrphanWorkerSessions(this.sessions, this.pool, this.client);
    await reapCleanupPending(this.sessions);
    await checkRejectedReviews(
      this.sessions,
      this.pool,
      this.client,
      (s, msg) => resumeOneSession(s, msg, this.client, this.pool),
      this.opts.maxConcurrent,
    );

    if (this.pool.activeCount >= this.opts.maxConcurrent) {
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    const dispatched = await dispatchTasks(this.client, this.pool, this.rateLimiter, this.prMonitor, {
      maxConcurrent: this.opts.maxConcurrent,
      pollInterval: this.opts.pollInterval,
    });

    this.backoffMs = this.opts.pollInterval;
    this.schedulePoll(this.opts.pollInterval);
  }

  private async killCancelledTasks(): Promise<void> {
    for (const taskId of this.pool.getActiveTaskIds()) {
      const task = (await apiCallOptional("getTask", () => this.client.getTask(taskId))) as { status?: string } | null;
      if (task?.status === "cancelled") await this.pool.killTask(taskId);
    }
  }

  private handleTickError(err: any): void {
    if (err instanceof ApiError && err.status === 429) {
      logger.warn("Rate limited, backing off");
      this.backoffMs = Math.min(Math.max(this.backoffMs * 2, 30000), 60000);
    } else {
      logger.warn(`Poll error: ${err.message}${err.cause ? ` — cause: ${err.cause.message ?? err.cause}` : ""}`);
      this.backoffMs = Math.min(this.backoffMs * 2, 60000);
    }
    this.schedulePoll(this.backoffMs);
  }
}
