import type { CreateRepositoryInput, Repository } from "@agent-kanban/shared";
import { type D1, newId } from "./db";

/** Normalize git URL to canonical HTTPS form without .git suffix */
export function normalizeGitUrl(url: string): string {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  return url.replace(/\.git$/, "");
}

/** Extract owner/repo from canonical HTTPS URL */
function extractFullName(httpsUrl: string): string | null {
  const match = httpsUrl.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function withFullName<T extends { url: string }>(repo: T): T & { full_name: string | null } {
  return { ...repo, full_name: extractFullName(repo.url) };
}

export async function createRepository(db: D1, ownerId: string, input: CreateRepositoryInput): Promise<Repository> {
  const id = newId();
  const now = new Date().toISOString();
  const url = normalizeGitUrl(input.url);

  await db
    .prepare("INSERT INTO repositories (id, owner_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, ownerId, input.name, url, now)
    .run();

  return withFullName({ id, owner_id: ownerId, name: input.name, url, created_at: now });
}

export async function findOrCreateRepository(db: D1, ownerId: string, input: CreateRepositoryInput): Promise<Repository> {
  try {
    return await createRepository(db, ownerId, input);
  } catch {
    const existing = await db
      .prepare("SELECT * FROM repositories WHERE owner_id = ? AND url = ?")
      .bind(ownerId, normalizeGitUrl(input.url))
      .first<Repository>();
    if (existing) return existing;
    throw new Error("Failed to create or find repository");
  }
}

export async function listRepositories(db: D1, ownerId: string, filters?: { url?: string }): Promise<Repository[]> {
  let query = `
    SELECT r.*, COUNT(t.id) as task_count
    FROM repositories r
    LEFT JOIN tasks t ON t.repository_id = r.id
    WHERE r.owner_id = ?`;
  const binds: string[] = [ownerId];

  if (filters?.url) {
    query += " AND r.url = ?";
    binds.push(normalizeGitUrl(filters.url));
  }

  query += " GROUP BY r.id ORDER BY r.created_at DESC";
  const result = await db
    .prepare(query)
    .bind(...binds)
    .all<Repository>();
  return result.results.map(withFullName);
}

export async function deleteRepository(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM repositories WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
