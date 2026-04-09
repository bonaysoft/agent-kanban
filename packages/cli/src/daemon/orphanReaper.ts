/**
 * OrphanReaper — detects and cleans up orphan worker sessions.
 *
 * Worker sessions with status="active" but NOT held by RuntimePool are
 * orphans from a previous daemon incarnation. Also retries sessions
 * that have cleanupPending from a failed workspace cleanup.
 */

import { createLogger } from "../logger.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionFile } from "../session/types.js";
import { cleanupWorkspace } from "../workspace/workspace.js";
import { apiCallOptional, apiFireAndForget, cleanupSync } from "./boundaries.js";
import { CleanupError } from "./errors.js";
import type { RuntimePool } from "./runtimePool.js";

const logger = createLogger("orphan-reaper");

/**
 * Find active worker sessions not in the pool and reap them.
 *
 * Decision tree per orphan:
 *   - task deleted (404)        -> cleanup workspace + remove session
 *   - task done / cancelled     -> cleanup workspace + remove session
 *   - task still viable         -> release task + cleanup + remove session
 */
export async function reapOrphanWorkerSessions(
  sessions: SessionManager,
  pool: RuntimePool,
  client: { getTask(id: string): Promise<unknown>; releaseTask(id: string): Promise<unknown> },
): Promise<void> {
  for (const s of sessions.list({ type: "worker", status: "active" })) {
    if (!s.taskId || pool.hasTask(s.taskId)) continue;

    const task = (await apiCallOptional("getTask", () => client.getTask(s.taskId!))) as { status?: string } | null;

    if (!task) {
      logger.warn(`Task ${s.taskId} not found (deleted), reaping orphan session`);
      await completeTerminal(sessions, s);
      continue;
    }

    if (task.status === "done" || task.status === "cancelled") {
      logger.info(`Reaping orphan worker session for task ${s.taskId} (status=${task.status})`);
      await completeTerminal(sessions, s);
      continue;
    }

    await apiFireAndForget(
      "releaseTask",
      () => client.releaseTask(s.taskId!),
      (msg) => logger.warn(`Failed to release orphan task ${s.taskId}: ${msg}`),
    );
    logger.info(`Released orphan task ${s.taskId} and reaped its session`);
    await completeTerminal(sessions, s);
  }
}

/**
 * Retry cleanup for sessions that had a prior cleanup failure.
 * These are sessions in "completing" state with cleanupPending=true.
 */
export async function reapCleanupPending(sessions: SessionManager): Promise<void> {
  for (const s of sessions.list({ type: "worker", status: "completing" as any })) {
    if (!s.cleanupPending) continue;
    logger.info(`Retrying cleanup for session ${s.sessionId.slice(0, 8)}`);
    try {
      if (s.workspace) cleanupSync("workspace-retry", () => cleanupWorkspace(s.workspace!));
      await sessions.applyEvent(s.sessionId, { type: "cleanup_done" });
    } catch (err) {
      logger.warn(`Cleanup retry failed for ${s.sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
      // Leave cleanupPending=true, retry next tick
    }
  }
}

/**
 * Drive an active orphan session through the state machine to terminal.
 * If workspace cleanup fails (CleanupError), marks the session with
 * cleanupPending so reapCleanupPending retries on the next tick.
 */
async function completeTerminal(sessions: SessionManager, s: SessionFile): Promise<void> {
  await sessions.applyEvent(s.sessionId, { type: "orphan_detected" });
  try {
    if (s.workspace) cleanupSync("workspace", () => cleanupWorkspace(s.workspace!));
    await sessions.applyEvent(s.sessionId, { type: "cleanup_done" });
  } catch (err) {
    if (err instanceof CleanupError) {
      logger.warn(`Workspace cleanup failed for ${s.sessionId.slice(0, 8)}, will retry: ${err.message}`);
      await sessions.patch(s.sessionId, { cleanupPending: true });
      return;
    }
    // Non-cleanup error (shouldn't happen in practice) — still try to terminate
    logger.error(`Unexpected error in completeTerminal for ${s.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    await sessions.applyEvent(s.sessionId, { type: "cleanup_done" }).catch(() => {});
  }
}
