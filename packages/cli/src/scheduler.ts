import { ApiError, type MachineClient } from "./client.js";
import { createLogger } from "./logger.js";
import type { PrMonitor } from "./prMonitor.js";
import type { ProcessManager } from "./processManager.js";
import { ensureCloned, prepareRepo, removeWorktree, repoDir } from "./repoOps.js";
import { loadSessions, removeSession } from "./savedSessions.js";
import { ensureLefthookTask } from "./skillManager.js";
import type { TaskRunner } from "./taskRunner.js";

const logger = createLogger("scheduler");

export interface SchedulerOpts {
  maxConcurrent: number;
  pollInterval: number;
}

export class Scheduler {
  private running = false;
  private paused = false;
  private resumeTargetMs = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
  }

  pauseForRateLimit(resetAt: string): void {
    const resetTime = new Date(resetAt).getTime();
    if (this.paused && resetTime <= this.resumeTargetMs) return;
    this.paused = true;
    this.resumeTargetMs = resetTime;
    const waitMs = Math.max(resetTime - Date.now(), 60_000);
    logger.warn(`Usage exhausted — pausing dispatch until ${resetAt} (${Math.round(waitMs / 60_000)}min)`);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => this.resume().catch((e) => logger.error(`Resume error: ${e.message}`)), waitMs);
  }

  onSlotFreed(): void {
    this.schedulePoll(this.opts.pollInterval);
  }

  private schedulePoll(delayMs: number): void {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.tick().catch((e) => this.handleTickError(e)), delayMs);
  }

  private async resume(): Promise<void> {
    if (!this.running || !this.paused) return;
    logger.info("Rate limit window reset, resuming");
    this.paused = false;
    this.resumeTargetMs = 0;
    await this.resumeSavedSessions();
    this.schedulePoll(0);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.paused) return;

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
      // Session marked active but no process running — stale from crash
      const task = (await this.client.getTask(s.taskId)) as any;
      if (!task || task.status === "done" || task.status === "cancelled") {
        removeWorktree(s.repoDir, s.cwd, s.branchName);
        removeSession(s.taskId);
      } else {
        // Task still viable — release and let it be re-dispatched
        await this.client.releaseTask(s.taskId).catch(() => {});
        removeWorktree(s.repoDir, s.cwd, s.branchName);
        removeSession(s.taskId);
        logger.info(`Cleaned up orphaned session for task ${s.taskId}`);
      }
    }

    // Resume rate-limited sessions (only when not paused)
    if (!this.paused) {
      for (const s of loadSessions("rate_limited")) {
        if (this.pm.activeCount >= this.opts.maxConcurrent) return;
        if (this.pm.hasTask(s.taskId)) continue;
        await this.runner.resumeSession(s, "");
      }
    }

    // Resume rejected review sessions
    for (const s of loadSessions("in_review")) {
      if (this.pm.activeCount >= this.opts.maxConcurrent) return;
      if (this.pm.hasTask(s.taskId)) continue;
      const task = (await this.client.getTask(s.taskId)) as any;

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

    const available = tasks.filter((t: any) => {
      if (t.blocked || !t.assigned_to || this.pm.hasTask(t.id) || !t.repository_id) return false;
      const repo = repoById.get(t.repository_id);
      return repo && repoDir(repo.url) !== null;
    });

    if (available.length === 0) {
      this.backoffMs = this.opts.pollInterval;
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    const task = available[0];
    const repo = repoById.get(task.repository_id)!;
    const dir = repoDir(repo.url);

    if (!prepareRepo(dir)) {
      logger.error(`Repo not ready at ${dir}, skipping task ${task.id}`);
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    if (await ensureLefthookTask(this.client, task, dir, tasks)) {
      this.schedulePoll(this.opts.pollInterval);
      return;
    }

    const dispatched = await this.runner.dispatch(task, dir);
    if (dispatched) this.prMonitor.track(task.id);

    this.backoffMs = this.opts.pollInterval;
    this.schedulePoll(this.opts.pollInterval);
  }

  private handleTickError(err: any): void {
    if (err instanceof ApiError && err.status === 429) {
      logger.warn("Rate limited, backing off");
      this.backoffMs = Math.min(Math.max(this.backoffMs * 2, 30000), 60000);
    } else {
      logger.warn(`Poll error: ${err.message}`);
      this.backoffMs = Math.min(this.backoffMs * 2, 60000);
    }
    this.schedulePoll(this.backoffMs);
  }
}
