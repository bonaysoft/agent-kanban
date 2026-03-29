import { STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import type { D1 } from "./db";
import { releaseTask } from "./taskRepo";

export async function detectAndReleaseStale(db: D1, boardId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString();

  const staleTasks = await db
    .prepare(`
    SELECT t.id, t.assigned_to FROM tasks t
    WHERE t.board_id = ? AND t.status = 'in_progress' AND t.assigned_to IS NOT NULL
    AND (
      SELECT MAX(tl.created_at) FROM task_actions tl WHERE tl.task_id = t.id
    ) < ?
  `)
    .bind(boardId, cutoff)
    .all<{ id: string; assigned_to: string }>();

  for (const stale of staleTasks.results) {
    await releaseTask(db, stale.id, "machine", "system", "machine", "timed_out");
  }
}
