import type { Board, BoardWithTasks, Task } from "@agent-kanban/shared";
import { type D1 } from "./db";
import { computeBlocked } from "./taskDeps";

export async function getBoard(db: D1, boardId: string): Promise<BoardWithTasks | null> {
  const board = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first<Board>();
  if (!board) return null;

  const tasks = await db.prepare(`
    SELECT t.*, a.name as agent_name, r.name as repository_name FROM tasks t
    LEFT JOIN agents a ON t.assigned_to = a.id
    LEFT JOIN repositories r ON t.repository_id = r.id
    WHERE t.board_id = ?
    ORDER BY t.position
  `).bind(boardId).all<Task>();

  const taskIds = tasks.results.map((t: Task) => t.id);
  if (taskIds.length > 0) {
    const blockedSet = await computeBlocked(db, taskIds);
    for (const task of tasks.results) {
      task.blocked = blockedSet.has(task.id);
    }
  }

  return { ...board, tasks: tasks.results };
}

export async function getBoardByProject(db: D1, projectId: string): Promise<Board | null> {
  return db.prepare(
    "SELECT * FROM boards WHERE project_id = ? LIMIT 1"
  ).bind(projectId).first<Board>();
}

export async function getDefaultBoard(db: D1, ownerId: string): Promise<Board | null> {
  return db.prepare(
    "SELECT b.* FROM boards b JOIN projects p ON b.project_id = p.id WHERE p.owner_id = ? ORDER BY b.created_at ASC LIMIT 1"
  ).bind(ownerId).first<Board>();
}
