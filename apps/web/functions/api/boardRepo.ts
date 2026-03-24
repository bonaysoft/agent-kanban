import type { Board, BoardWithTasks, Task } from "@agent-kanban/shared";
import { seedBuiltinAgents } from "./agentRepo";
import { type D1, newId, parseJsonFields } from "./db";
import { computeBlocked } from "./taskDeps";

export async function createBoard(
  db: D1,
  ownerId: string,
  name: string,
  description?: string,
): Promise<Board> {
  const id = newId();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO boards (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, ownerId, name, description || null, now, now)
    .run();

  await seedBuiltinAgents(db, ownerId);

  return {
    id,
    owner_id: ownerId,
    name,
    description: description || null,
    created_at: now,
    updated_at: now,
  };
}

export async function listBoards(db: D1, ownerId: string): Promise<Board[]> {
  const result = await db
    .prepare("SELECT * FROM boards WHERE owner_id = ? ORDER BY created_at DESC")
    .bind(ownerId)
    .all<Board>();
  return result.results;
}

export async function getBoardByName(db: D1, ownerId: string, name: string): Promise<Board | null> {
  return db
    .prepare("SELECT * FROM boards WHERE owner_id = ? AND name = ?")
    .bind(ownerId, name)
    .first<Board>();
}

export async function getBoard(db: D1, boardId: string): Promise<BoardWithTasks | null> {
  const board = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first<Board>();
  if (!board) return null;

  const tasks = await db
    .prepare(`
    SELECT t.*, a.name as agent_name, a.public_key as agent_public_key, r.name as repository_name FROM tasks t
    LEFT JOIN agents a ON t.assigned_to = a.id
    LEFT JOIN repositories r ON t.repository_id = r.id
    WHERE t.board_id = ?
    ORDER BY t.position
  `)
    .bind(boardId)
    .all<Task>();

  const taskIds = tasks.results.map((t: Task) => t.id);
  if (taskIds.length > 0) {
    const blockedSet = await computeBlocked(db, taskIds);
    for (const task of tasks.results) {
      task.blocked = blockedSet.has(task.id);
    }
  }

  return { ...board, tasks: tasks.results.map((t) => parseJsonFields(t, ["labels", "input"])) };
}

export async function getDefaultBoard(db: D1, ownerId: string): Promise<Board | null> {
  return db
    .prepare("SELECT * FROM boards WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1")
    .bind(ownerId)
    .first<Board>();
}

export async function updateBoard(
  db: D1,
  boardId: string,
  updates: { name?: string; description?: string },
): Promise<Board | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.description || null);
  }
  if (sets.length === 0)
    return db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first<Board>();

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(boardId);

  await db
    .prepare(`UPDATE boards SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  return db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first<Board>();
}

export async function deleteBoard(db: D1, boardId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM boards WHERE id = ?").bind(boardId).run();
  return result.meta.changes > 0;
}
