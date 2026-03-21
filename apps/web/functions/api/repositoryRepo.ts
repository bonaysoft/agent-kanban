import type { Repository, CreateRepositoryInput } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function createRepository(db: D1, userId: string, input: CreateRepositoryInput): Promise<Repository> {
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO repositories (id, user_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, userId, input.name, input.url, now).run();

  return { id, user_id: userId, name: input.name, url: input.url, created_at: now };
}

export async function findOrCreateRepository(db: D1, userId: string, input: CreateRepositoryInput): Promise<Repository> {
  try {
    return await createRepository(db, userId, input);
  } catch {
    const existing = await db.prepare(
      "SELECT * FROM repositories WHERE user_id = ? AND url = ?"
    ).bind(userId, input.url).first<Repository>();
    if (existing) return existing;
    throw new Error("Failed to create or find repository");
  }
}

export async function listRepositories(db: D1, userId: string): Promise<Repository[]> {
  const result = await db.prepare(`
    SELECT r.*, COUNT(t.id) as task_count
    FROM repositories r
    LEFT JOIN tasks t ON t.repository_id = r.id
    WHERE r.user_id = ?
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).bind(userId).all<Repository>();
  return result.results;
}

export async function deleteRepository(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM repositories WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
