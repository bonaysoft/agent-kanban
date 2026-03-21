import type { Board, BoardWithTasks, Task } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";
import { computeBlocked } from "./taskDeps";

export async function createBoard(db: D1, ownerId: string, name: string): Promise<Board> {
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO boards (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, ownerId, name, now, now).run();

  return { id, owner_id: ownerId, name, created_at: now, updated_at: now };
}

export async function listBoards(db: D1, ownerId: string): Promise<Board[]> {
  const result = await db.prepare(
    "SELECT * FROM boards WHERE owner_id = ? ORDER BY created_at DESC"
  ).bind(ownerId).all<Board>();
  return result.results;
}

export async function getBoard(db: D1, boardId: string): Promise<BoardWithTasks | null> {
  const board = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first<Board>();
  if (!board) return null;

  const tasks = await db.prepare(`
    SELECT t.*, a.name as agent_name, p.name as project_name FROM tasks t
    LEFT JOIN agents a ON t.assigned_to = a.id
    LEFT JOIN projects p ON t.project_id = p.id
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

export async function deleteBoard(db: D1, boardId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM boards WHERE id = ?").bind(boardId).run();
  return result.meta.changes > 0;
}

export async function getDefaultBoard(db: D1, ownerId: string): Promise<Board | null> {
  return db.prepare(
    "SELECT * FROM boards WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1"
  ).bind(ownerId).first<Board>();
}
