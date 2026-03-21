import type { Repository, CreateRepositoryInput } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function createRepository(db: D1, ownerId: string, input: CreateRepositoryInput): Promise<Repository> {
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO repositories (id, owner_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, ownerId, input.name, input.url, now).run();

  return { id, owner_id: ownerId, name: input.name, url: input.url, created_at: now };
}

export async function findOrCreateRepository(db: D1, ownerId: string, input: CreateRepositoryInput): Promise<Repository> {
  try {
    return await createRepository(db, ownerId, input);
  } catch {
    const existing = await db.prepare(
      "SELECT * FROM repositories WHERE owner_id = ? AND url = ?"
    ).bind(ownerId, input.url).first<Repository>();
    if (existing) return existing;
    throw new Error("Failed to create or find repository");
  }
}

export async function listRepositories(db: D1, ownerId: string): Promise<Repository[]> {
  const result = await db.prepare(`
    SELECT r.*, COUNT(t.id) as task_count
    FROM repositories r
    LEFT JOIN tasks t ON t.repository_id = r.id
    WHERE r.owner_id = ?
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).bind(ownerId).all<Repository>();
  return result.results;
}

export async function deleteRepository(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM repositories WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
