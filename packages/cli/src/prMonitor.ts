import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ApiClient } from "./client.js";
import { createLogger } from "./logger.js";
import { TRACKED_TASKS_FILE } from "./paths.js";

const logger = createLogger("pr-monitor");

// PR Monitor: watches in_review tasks spawned by this machine.
//   PR merged  → task done
//   PR closed  → task cancelled

const PR_CHECK_INTERVAL = 30_000; // 30s

interface ReviewTask {
  id: string;
  pr_url: string;
  assigned_to: string | null;
}

export class PrMonitor {
  private client: ApiClient;
  private trackedTasks: Set<string>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private failureCount = 0;
  private taskFailures = new Map<string, number>();

  constructor(client: ApiClient) {
    this.client = client;
    this.trackedTasks = loadTrackedTasks();
  }

  start(): void {
    this.timer = setInterval(() => this.check(), PR_CHECK_INTERVAL);
    logger.info(`PR monitor started (tracking=${this.trackedTasks.size}, interval=30s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  track(taskId: string): void {
    this.trackedTasks.add(taskId);
    saveTrackedTasks(this.trackedTasks);
  }

  untrack(taskId: string): void {
    this.trackedTasks.delete(taskId);
    this.taskFailures.delete(taskId);
    saveTrackedTasks(this.trackedTasks);
  }

  private async check(): Promise<void> {
    if (this.checking || this.trackedTasks.size === 0) return;
    this.checking = true;

    try {
      const tasks = (await this.client.listTasks({ status: "in_review" })) as ReviewTask[];
      const inReviewIds = new Set(tasks.map((t) => t.id));
      const monitored = tasks.filter((t) => t.pr_url && this.trackedTasks.has(t.id));

      for (const task of monitored) {
        const state = getPrState(task.pr_url);
        if (!state) {
          const count = (this.taskFailures.get(task.id) ?? 0) + 1;
          this.taskFailures.set(task.id, count);
          if (count === 20) {
            logger.warn(`Cannot check PR status for task ${task.id} (${task.pr_url}), gh may need re-auth`);
          }
          continue;
        }

        this.taskFailures.delete(task.id);

        if (state === "MERGED") {
          logger.info(`PR merged for task ${task.id}, marking done`);
          await this.client.completeTask(task.id, { result: "PR merged" });
          this.untrack(task.id);
        } else if (state === "CLOSED") {
          logger.info(`PR closed for task ${task.id}, marking cancelled`);
          await this.client.cancelTask(task.id);
          this.untrack(task.id);
        }
      }

      // Untrack tasks that are done/cancelled (not just "not in_review" — in_progress tasks are still working)
      const allTasks = (await this.client.listTasks({})) as ReviewTask[];
      const taskStatusById = new Map(allTasks.map((t) => [t.id, (t as any).status]));
      for (const taskId of [...this.trackedTasks]) {
        if (inReviewIds.has(taskId)) continue;
        const status = taskStatusById.get(taskId);
        if (status === "done" || status === "cancelled" || !status) {
          logger.info(`Task ${taskId} is ${status ?? "unknown"}, untracking`);
          this.untrack(taskId);
        }
      }

      this.failureCount = 0;
    } catch (err: any) {
      this.failureCount++;
      if (this.failureCount === 10 || (this.failureCount > 10 && this.failureCount % 10 === 0)) {
        logger.error(`PR monitor has failed ${this.failureCount} consecutive checks: ${err.message}. Check gh auth status.`);
      } else if (this.failureCount < 10) {
        logger.warn(`PR monitor error: ${err.message}`);
      }
    } finally {
      this.checking = false;
    }
  }
}

function getPrState(prUrl: string): "OPEN" | "MERGED" | "CLOSED" | null {
  try {
    const raw = execSync(`gh pr view "${prUrl}" --json state -q .state`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    })
      .toString()
      .trim();
    if (raw === "OPEN" || raw === "MERGED" || raw === "CLOSED") return raw;
    return null;
  } catch {
    return null;
  }
}

function loadTrackedTasks(): Set<string> {
  try {
    const data = JSON.parse(readFileSync(TRACKED_TASKS_FILE, "utf-8"));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

function saveTrackedTasks(tasks: Set<string>): void {
  mkdirSync(dirname(TRACKED_TASKS_FILE), { recursive: true });
  writeFileSync(TRACKED_TASKS_FILE, `${JSON.stringify([...tasks])}\n`);
}
