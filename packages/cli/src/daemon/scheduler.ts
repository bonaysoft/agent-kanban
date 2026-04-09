import { isBoardType } from "@agent-kanban/shared";
import { ApiError, type MachineClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import { normalizeRuntime } from "../providers/registry.js";
import { isPidAlive, listSessions, removeSession } from "../session/store.js";
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

  pauseForRateLimit(runtime: string, resetAt: string): void {
    const resetTime = new Date(resetAt).getTime();
    const existing = this.pausedRuntimes.get(runtime);
    if (existing && resetTime <= existing.resumeMs) return;
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
   * Called when a live agent's SDK reports that the runtime's main quota has
   * recovered (rate_limit event with status=allowed, isUsingOverage=false).
   * Cancels the pending pause timer and resumes saved rate-limited sessions
   * through the same code path used when the timer naturally expires.
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

  /**
   * Resume rate-limited sessions for a specific runtime. Called only from
   * `resumeRuntime`, which is itself the single exit point for a paused
   * runtime (timer expiry or `resumeRateLimit` event).
   *
   * Assumes `runtime` is already in canonical AgentRuntime form — all current
   * providers use names that match their runtime key, but a new provider with
   * a non-canonical `name` would silently be skipped here.
   */
  private async resumeRateLimitedSessions(runtime: string): Promise<void> {
    for (const s of listSessions({ type: "worker", status: "rate_limited" })) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (s.runtime !== runtime) continue;
      if (!s.taskId || this.pm.hasTask(s.taskId)) continue;

      // Drop sessions for tasks that moved past in_progress while we were paused.
      // Without this, a done/cancelled task would get a redundant agent spawn
      // that fails at claim-time and leaves a zombie session on disk.
      const task = await this.client.getTask(s.taskId).catch(() => null);
      if (!task || (task as { status: string }).status !== "in_progress") {
        logger.info(
          `Discarding stale rate_limited session for task ${s.taskId} (status=${(task as { status: string } | null)?.status ?? "missing"})`,
        );
        removeSession(s.sessionId);
        continue;
      }

      await this.runner.resumeSession(s, "");
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    await this.killCancelledTasks();
    await this.resumeSavedSessions();

    if (this.pm.activeCount >= this.opts.maxConcurrent) {
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    await this.dispatchTasks();
  }

  private async killCancelledTasks(): Promise<void> {
    for (const taskId of this.pm.getActiveTaskIds()) {
      const task = (await this.client.getTask(taskId)) as any;
      if (task?.status === "cancelled") await this.pm.killTask(taskId);
    }
  }

  private async resumeSavedSessions(): Promise<void> {
    // Clean up orphaned active worker sessions (crash recovery)
    for (const s of listSessions({ type: "worker", status: "active" })) {
      if (!s.taskId || this.pm.hasTask(s.taskId)) continue;
      if (isPidAlive(s.pid)) continue;
      let task: any;
      try {
        task = await this.client.getTask(s.taskId);
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          logger.warn(`Task ${s.taskId} not found (deleted), cleaning up orphaned session`);
          cleanupWorkspace(s.workspace!);
          removeSession(s.sessionId);
          continue;
        }
        throw err;
      }
      if (!task || task.status === "done" || task.status === "cancelled") {
        logger.info(`Cleaning up orphaned active session for task ${s.taskId} (task status=${task?.status ?? "missing"})`);
        cleanupWorkspace(s.workspace!);
        removeSession(s.sessionId);
      } else {
        // Task still viable — release and let it be re-dispatched
        await this.client.releaseTask(s.taskId).catch(() => {});
        cleanupWorkspace(s.workspace!);
        removeSession(s.sessionId);
        logger.info(`Cleaned up orphaned session for task ${s.taskId}`);
      }
    }

    // Note: rate-limited session resume is NOT done here. It happens exclusively
    // in `resumeRuntime` (triggered by the pause timer or by an SDK "allowed"
    // event via resumeRateLimit). Tick-level scanning would race with those
    // signals and resurrect sessions the wrong runtime state.

    // Resume rejected review sessions
    for (const s of listSessions({ type: "worker", status: "in_review" })) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (!s.taskId || this.pm.hasTask(s.taskId)) continue;
      let task: any;
      try {
        task = await this.client.getTask(s.taskId);
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          logger.warn(`Task ${s.taskId} not found (deleted), cleaning up review session`);
          cleanupWorkspace(s.workspace!);
          removeSession(s.sessionId);
          continue;
        }
        throw err;
      }

      if (!task || task.status === "done" || task.status === "cancelled") {
        logger.info(`Cleaning up review session for task ${s.taskId} (task status=${task?.status ?? "missing"})`);
        cleanupWorkspace(s.workspace!);
        removeSession(s.sessionId);
        continue;
      }

      if (task.status === "in_progress") {
        const notes = (await this.client.getTaskNotes(s.taskId)) as any[];
        const rejectLog = [...notes].reverse().find((l: any) => l.action === "rejected");
        const reason = rejectLog?.detail || "No reason provided";
        const message = `Task rejected. Reason: ${reason}\n\nPlease fix the issues and submit for review again.`;
        await this.runner.resumeSession(s, message);
      }
    }
  }

  private async dispatchTasks(): Promise<void> {
    const tasks = (await this.client.listTasks({ status: "todo" })) as any[];
    const repos = await this.client.listRepositories();
    const repoById = new Map(repos.map((r: any) => [r.id, r]));

    // Ensure repos are cloned
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

    // Resolve agent runtimes and skip tasks whose runtime is paused
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
