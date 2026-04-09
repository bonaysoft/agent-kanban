/**
 * Scheduler — owns the tick loop and makes dispatch decisions.
 *
 * Key invariants (replacing the previous fragile design):
 *   1. Scheduler never writes session files directly. All session mutations
 *      go through SessionManager (which owns the mutex + state machine).
 *   2. Orphan detection for worker sessions is purely in-memory: any session
 *      not held by ProcessManager (via `hasTask`) is orphaned by definition.
 *      No pid check, no ps scan.
 *   3. Resume paths are unified through TaskRunner.resumeSession. The three
 *      triggers (rate-limit window expiry, in_review→in_progress reject,
 *      post-crash recovery) all call the same method with the same contract.
 *   4. Transient errors during resume do NOT tight-loop. SessionManager's
 *      persisted resumeBackoffMs + resumeAfter gate retries.
 *   5. pauseForRateLimit never overwrites a longer-lived pause. "Last one
 *      wins" was a bug; the max wins.
 */

import { isBoardType } from "@agent-kanban/shared";
import { ApiError, type MachineClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import { normalizeRuntime } from "../providers/registry.js";
import { getSessionManager } from "../session/manager.js";
import type { SessionFile } from "../session/types.js";
import { ensureCloned, prepareRepo, repoDir } from "../workspace/repoOps.js";
import { ensureLefthookTask } from "../workspace/skills.js";
import { cleanupWorkspace } from "../workspace/workspace.js";
import type { PrMonitor } from "./prMonitor.js";
import type { ProcessManager } from "./processManager.js";
import type { TaskRunner } from "./taskRunner.js";

const logger = createLogger("scheduler");

export interface SchedulerOpts {
  maxConcurrent: number;
  pollInterval: number;
}

interface RuntimePause {
  resumeMs: number;
  timer: ReturnType<typeof setTimeout>;
}

export class Scheduler {
  private sessions = getSessionManager();
  private running = false;
  private pausedRuntimes = new Map<string, RuntimePause>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs: number;

  constructor(
    private client: MachineClient,
    private pm: ProcessManager,
    private runner: TaskRunner,
    private prMonitor: PrMonitor,
    private opts: SchedulerOpts,
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
    for (const p of this.pausedRuntimes.values()) clearTimeout(p.timer);
    this.pausedRuntimes.clear();
  }

  /**
   * Pause a runtime until `resetAt`. If a longer-lived pause is already
   * active for this runtime, the existing window wins — "last one wins"
   * was a bug that caused scheduler to resume too early.
   */
  pauseForRateLimit(runtime: string, resetAt: string): void {
    const resetTime = new Date(resetAt).getTime();
    const existing = this.pausedRuntimes.get(runtime);
    if (existing && existing.resumeMs >= resetTime) return; // keep the longer one
    if (existing) clearTimeout(existing.timer);
    const waitMs = Math.max(resetTime - Date.now(), 60_000);
    logger.warn(`Runtime "${runtime}" rate limited — pausing until ${resetAt} (${Math.round(waitMs / 60_000)}min)`);
    const timer = setTimeout(() => this.resumeRuntime(runtime).catch((e) => logger.error(`Resume error: ${e.message}`)), waitMs);
    this.pausedRuntimes.set(runtime, { resumeMs: resetTime, timer });
  }

  onSlotFreed(): void {
    this.schedulePoll(this.opts.pollInterval);
  }

  /**
   * SDK reported that the runtime's main quota has recovered. Clear the pause
   * window and resume saved rate-limited sessions through the same path as
   * natural timer expiry.
   */
  resumeRateLimit(runtime: string): void {
    const existing = this.pausedRuntimes.get(runtime);
    if (!existing) return;
    clearTimeout(existing.timer);
    this.resumeRuntime(runtime).catch((e) => logger.error(`Resume error: ${e.message}`));
  }

  isRuntimePaused(runtime: string): boolean {
    return this.pausedRuntimes.has(runtime);
  }

  private schedulePoll(delayMs: number): void {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.tick().catch((e) => this.handleTickError(e)), delayMs);
  }

  private async resumeRuntime(runtime: string): Promise<void> {
    if (!this.running) return;
    logger.info(`Rate limit window reset for "${runtime}", resuming`);
    this.pausedRuntimes.delete(runtime);
    await this.resumeRateLimitedSessions(runtime);
    this.schedulePoll(0);
  }

  private async resumeRateLimitedSessions(runtime: string): Promise<void> {
    const now = Date.now();
    for (const s of this.sessions.list({ type: "worker", status: "rate_limited" })) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (s.runtime !== runtime) continue;
      if (!s.taskId || this.pm.hasTask(s.taskId)) continue;
      if (s.resumeAfter && s.resumeAfter > now) continue; // honor persisted backoff

      await this.resumeOneSession(s, "");
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    await this.killCancelledTasks();
    await this.reapOrphanWorkerSessions();
    await this.resumeRejectedReviewSessions();

    if (this.pm.activeCount >= this.opts.maxConcurrent) {
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    await this.dispatchTasks();
  }

  private async killCancelledTasks(): Promise<void> {
    for (const taskId of this.pm.getActiveTaskIds()) {
      const task = (await this.client.getTask(taskId)) as { status?: string } | null;
      if (task?.status === "cancelled") await this.pm.killTask(taskId);
    }
  }

  /**
   * Worker sessions with status="active" but NOT held by ProcessManager are
   * orphans from a previous daemon incarnation. There is no valid reason for
   * an active worker session to exist without an in-memory handle — any such
   * session is leftover state from a crash.
   *
   * Decision tree per orphan:
   *   - task deleted (404)        → cleanup workspace + remove session
   *   - task done / cancelled     → cleanup workspace + remove session
   *   - task still viable         → release task + cleanup + remove session
   *
   * Transitions go through the state machine so an in_review session can
   * never be silently reaped here (the state machine refuses it).
   */
  private async reapOrphanWorkerSessions(): Promise<void> {
    for (const s of this.sessions.list({ type: "worker", status: "active" })) {
      if (!s.taskId || this.pm.hasTask(s.taskId)) continue;

      let task: { status?: string } | null = null;
      try {
        task = (await this.client.getTask(s.taskId)) as { status?: string } | null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          logger.warn(`Task ${s.taskId} not found (deleted), reaping orphan session`);
          await this.completeTerminal(s);
          continue;
        }
        throw err;
      }

      if (!task || task.status === "done" || task.status === "cancelled") {
        logger.info(`Reaping orphan worker session for task ${s.taskId} (status=${task?.status ?? "missing"})`);
        await this.completeTerminal(s);
        continue;
      }

      // Task still viable — release it on the server so someone can re-dispatch
      await this.client.releaseTask(s.taskId).catch(() => {});
      logger.info(`Released orphan task ${s.taskId} and reaped its session`);
      await this.completeTerminal(s);
    }
  }

  private async resumeRejectedReviewSessions(): Promise<void> {
    const now = Date.now();
    for (const s of this.sessions.list({ type: "worker", status: "in_review" })) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (!s.taskId || this.pm.hasTask(s.taskId)) continue;
      if (s.resumeAfter && s.resumeAfter > now) continue;

      let task: { status?: string } | null = null;
      try {
        task = (await this.client.getTask(s.taskId)) as { status?: string } | null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          logger.warn(`Task ${s.taskId} not found (deleted), cleaning up review session`);
          await this.completeTerminalFromReview(s, { type: "task_deleted" });
          continue;
        }
        throw err;
      }

      if (!task || task.status === "done" || task.status === "cancelled") {
        logger.info(`Cleaning up review session for task ${s.taskId} (task status=${task?.status ?? "missing"})`);
        await this.completeTerminalFromReview(s, { type: "task_cancelled" });
        continue;
      }

      if (task.status === "in_progress") {
        const notes = (await this.client.getTaskNotes(s.taskId)) as Array<{ action?: string; detail?: string }>;
        const rejectLog = [...notes].reverse().find((l) => l.action === "rejected");
        const reason = rejectLog?.detail || "No reason provided";
        const message = `Task rejected. Reason: ${reason}\n\nPlease fix the issues and submit for review again.`;
        await this.resumeOneSession(s, message);
      }
    }
  }

  /**
   * Single resume entry point. Routes through TaskRunner.resumeSession and
   * handles transient failures by setting persisted backoff so the next tick
   * doesn't tight-loop retry.
   */
  private async resumeOneSession(s: SessionFile, message: string): Promise<void> {
    const ok = await this.runner.resumeSession(s, message);
    if (ok) {
      // Clear backoff on success.
      await this.sessions.patch(s.sessionId, { resumeBackoffMs: undefined, resumeAfter: undefined }).catch(() => {});
      return;
    }
    // Transient — exponential backoff, cap at 5 min.
    const prev = s.resumeBackoffMs ?? 5000;
    const next = Math.min(prev * 2, 5 * 60_000);
    const resumeAfter = Date.now() + next;
    await this.sessions.patch(s.sessionId, { resumeBackoffMs: next, resumeAfter }).catch(() => {});
    logger.warn(`Resume backoff for session ${s.sessionId.slice(0, 8)} → ${Math.round(next / 1000)}s`);
  }

  /** Drive an active orphan session through the state machine to terminal. */
  private async completeTerminal(s: SessionFile): Promise<void> {
    try {
      await this.sessions.applyEvent(s.sessionId, { type: "orphan_detected" });
      if (s.workspace) cleanupWorkspace(s.workspace);
      await this.sessions.applyEvent(s.sessionId, { type: "cleanup_done" });
    } catch (err) {
      logger.warn(`Orphan reap failed for ${s.sessionId}: ${(err as Error).message}`);
    }
  }

  /** Drive an in_review session through the state machine to terminal. */
  private async completeTerminalFromReview(s: SessionFile, event: { type: "task_cancelled" | "task_deleted" }): Promise<void> {
    try {
      await this.sessions.applyEvent(s.sessionId, event);
      if (s.workspace) cleanupWorkspace(s.workspace);
      await this.sessions.applyEvent(s.sessionId, { type: "cleanup_done" });
    } catch (err) {
      logger.warn(`Review session cleanup failed for ${s.sessionId}: ${(err as Error).message}`);
    }
  }

  private async dispatchTasks(): Promise<void> {
    const tasks = (await this.client.listTasks({ status: "todo" })) as any[];
    const repos = await this.client.listRepositories();
    const repoById = new Map(repos.map((r: any) => [r.id, r]));

    // Ensure repos are cloned for any assigned task
    for (const t of tasks) {
      if (t.blocked || !t.assigned_to || this.pm.hasTask(t.id) || !t.repository_id) continue;
      const repo = repoById.get(t.repository_id);
      if (repo) ensureCloned(repo);
    }

    const now = new Date().toISOString();
    const available = tasks.filter((t: any) => {
      if (t.blocked || !t.assigned_to || this.pm.hasTask(t.id)) return false;
      if (t.scheduled_at && t.scheduled_at > now) return false;
      if (!t.repository_id) {
        if (t.board_type === "dev") {
          logger.warn(`Dev task ${t.id} has no repository_id, skipping`);
          return false;
        }
        return true;
      }
      const repo = repoById.get(t.repository_id);
      return repo && repoDir(repo.url) !== null;
    });

    if (available.length === 0) {
      this.backoffMs = this.opts.pollInterval;
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    // Resolve agent runtimes and skip tasks whose runtime is paused.
    const agentCache = new Map<string, string>();
    let task: any = null;
    for (const t of available) {
      let runtime = agentCache.get(t.assigned_to);
      if (runtime === undefined) {
        const agent = (await this.client.getAgent(t.assigned_to)) as any;
        runtime = normalizeRuntime(agent?.runtime ?? "claude");
        agentCache.set(t.assigned_to, runtime);
      }
      if (!this.isRuntimePaused(runtime)) {
        task = t;
        break;
      }
    }

    if (!task) {
      this.backoffMs = this.opts.pollInterval;
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    // Repo preparation — only for tasks with a repository
    let dir: string | null = null;
    if (task.repository_id) {
      const repo = repoById.get(task.repository_id)!;
      dir = repoDir(repo.url);

      if (!prepareRepo(dir)) {
        logger.error(`Repo not ready at ${dir}, skipping task ${task.id}`);
        this.schedulePoll(this.opts.pollInterval);
        return;
      }

      if (await ensureLefthookTask(this.client, task, dir, tasks)) {
        this.schedulePoll(this.opts.pollInterval);
        return;
      }
    }

    const boardType = task.board_type;
    if (!isBoardType(boardType)) {
      logger.error(`Task ${task.id} has invalid board_type "${boardType}", skipping`);
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    const dispatched = await this.runner.dispatch(task, dir, boardType);
    if (dispatched) this.prMonitor.track(task.id);

    this.backoffMs = this.opts.pollInterval;
    this.schedulePoll(this.opts.pollInterval);
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
