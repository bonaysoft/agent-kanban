/**
 * ReviewWatcher — monitors in_review sessions for status changes.
 *
 * Detects when a reviewer rejects a task (task flips back to in_progress),
 * or when a task is completed/cancelled while in review. Routes the session
 * through the appropriate resume or terminal path.
 */

import type { ApiClient } from "../client/index.js";
import { createLogger } from "../logger.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionEvent } from "../session/stateMachine.js";
import type { SessionFile } from "../session/types.js";
import { cleanupWorkspace } from "../workspace/workspace.js";
import { apiCallOptional } from "./boundaries.js";
import type { RuntimePool } from "./runtimePool.js";

const logger = createLogger("review-watcher");

export type ResumeCallback = (session: SessionFile, message: string) => Promise<void>;

/**
 * Scan in_review sessions and handle rejected reviews, completed tasks,
 * and deleted tasks.
 */
export async function checkRejectedReviews(
  sessions: SessionManager,
  pool: RuntimePool,
  client: ApiClient,
  resumeOne: ResumeCallback,
  maxConcurrent: number,
): Promise<void> {
  const now = Date.now();
  for (const s of sessions.list({ type: "worker", status: "in_review" })) {
    if (pool.activeCount >= maxConcurrent) return;
    if (!s.taskId || pool.hasTask(s.taskId)) continue;
    if (s.resumeAfter && s.resumeAfter > now) continue;

    const task = (await apiCallOptional("getTask", () => client.getTask(s.taskId!))) as { status?: string } | null;

    if (!task) {
      logger.warn(`Task ${s.taskId} not found (deleted), cleaning up review session`);
      await completeTerminalFromReview(sessions, s, { type: "task_deleted" });
      continue;
    }

    if (task.status === "done" || task.status === "cancelled") {
      logger.info(`Cleaning up review session for task ${s.taskId} (task status=${task.status})`);
      await completeTerminalFromReview(sessions, s, { type: "task_cancelled" });
      continue;
    }

    if (task.status === "in_progress") {
      const notes = (await client.getTaskNotes(s.taskId)) as Array<{ action?: string; detail?: string }>;
      const rejectLog = [...notes].reverse().find((l) => l.action === "rejected");
      const reason = rejectLog?.detail || "No reason provided";
      const message = `Task rejected. Reason: ${reason}\n\nPlease fix the issues and submit for review again.`;
      await resumeOne(s, message);
    }
  }
}

/** Drive an in_review session through the state machine to terminal. */
async function completeTerminalFromReview(
  sessions: SessionManager,
  s: SessionFile,
  event: { type: "task_cancelled" | "task_deleted" },
): Promise<void> {
  await sessions.applyEvent(s.sessionId, event).catch((e) => {
    logger.warn(`Review session event failed for ${s.sessionId}: ${errMessage(e)}`);
  });
  if (s.workspace) cleanupWorkspace(s.workspace);
  await sessions.applyEvent(s.sessionId, { type: "cleanup_done" }).catch((e) => {
    logger.warn(`Review session cleanup failed for ${s.sessionId}: ${errMessage(e)}`);
  });
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
