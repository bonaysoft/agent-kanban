import { STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import type { D1 } from "./db";
import { releaseTask } from "./taskRepo";
import { getColumnByBoardAndName } from "./boardRepo";
import { updateAgentStatus } from "./agentRepo";

export async function detectAndReleaseStale(db: D1, boardId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString();

  // Find in-progress tasks where the most recent log is older than the cutoff
  const staleTasks = await db.prepare(`
    SELECT t.id, t.assigned_to FROM tasks t
    JOIN columns c ON t.column_id = c.id
    WHERE c.board_id = ? AND c.name = 'In Progress' AND t.assigned_to IS NOT NULL
    AND (
      SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.task_id = t.id
    ) < ?
  `).bind(boardId, cutoff).all<{ id: string; assigned_to: string }>();

  if (staleTasks.results.length === 0) return;

  const todoCol = await getColumnByBoardAndName(db, boardId, "Todo");
  if (!todoCol) return;

  for (const stale of staleTasks.results) {
    await releaseTask(db, stale.id, todoCol.id, stale.assigned_to, "timed_out");
    await updateAgentStatus(db, stale.assigned_to, "offline");
  }
}
