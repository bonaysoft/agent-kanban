import { isBoardType } from "@agent-kanban/shared";
import { ApiError, type MachineClient } from "./client.js";
import { createLogger } from "./logger.js";
import type { PrMonitor } from "./prMonitor.js";
import type { ProcessManager } from "./processManager.js";
import { normalizeRuntime } from "./providers/registry.js";
import { ensureCloned, prepareRepo, repoDir } from "./repoOps.js";
import { loadSessions, removeSession } from "./savedSessions.js";
import { isProcessAlive } from "./sessionPids.js";
import { ensureLefthookTask } from "./skillManager.js";
import type { TaskRunner } from "./taskRunner.js";
import { cleanupWorkspace } from "./workspace.js";

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

  clearRateLimit(runtime: string): void {
    const existing = this.pausedRuntimes.get(runtime);
    if (!existing) return;
    logger.info(`Rate limit cleared for "${runtime}" — agent completed despite warning, resuming`);
    clearTimeout(existing.timer);
    this.pausedRuntimes.delete(runtime);
    this.schedulePoll(0);
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
    await this.resumeSavedSessions();
    this.schedulePoll(0);
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
    // Clean up orphaned active sessions (crash recovery)
    for (const s of loadSessions("active")) {
      if (this.pm.hasTask(s.taskId)) continue;
      // Check if the process is still alive before treating as orphan
      if (isProcessAlive(s.sessionId)) continue;
      let task: any;
      try {
        task = await this.client.getTask(s.taskId);
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          logger.warn(`Task ${s.taskId} not found (deleted), cleaning up orphaned session`);
          cleanupWorkspace(s.workspace);
          removeSession(s.taskId);
          continue;
        }
        throw err;
      }
      if (!task || task.status === "done" || task.status === "cancelled") {
        cleanupWorkspace(s.workspace);
        removeSession(s.taskId);
      } else {
        // Task still viable — release and let it be re-dispatched
        await this.client.releaseTask(s.taskId).catch(() => {});
        cleanupWorkspace(s.workspace);
        removeSession(s.taskId);
        logger.info(`Cleaned up orphaned session for task ${s.taskId}`);
      }
    }

    // Resume rate-limited sessions whose runtime is no longer paused
    for (const s of loadSessions("rate_limited")) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (this.pm.hasTask(s.taskId)) continue;
      if (this.isRuntimePaused(s.runtime)) continue;
      await this.runner.resumeSession(s, "");
    }

    // Resume rejected review sessions
    for (const s of loadSessions("in_review")) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (this.pm.hasTask(s.taskId)) continue;
      let task: any;
      try {
        task = await this.client.getTask(s.taskId);
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          logger.warn(`Task ${s.taskId} not found (deleted), cleaning up review session`);
          cleanupWorkspace(s.workspace);
          removeSession(s.taskId);
          continue;
        }
        throw err;
      }

      if (!task || task.status === "done" || task.status === "cancelled") {
        removeSession(s.taskId);
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
