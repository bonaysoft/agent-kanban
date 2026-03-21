import type { Project, Repository, ProjectWithRepositories, CreateRepositoryInput } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function createProject(db: D1, ownerId: string, name: string, description?: string): Promise<Project> {
  const projectId = newId();
  const boardId = newId();
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      "INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(projectId, ownerId, name, description || null, now, now),
    db.prepare(
      "INSERT INTO boards (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(boardId, projectId, name, now, now),
  ]);

  return { id: projectId, owner_id: ownerId, name, description: description || null, created_at: now, updated_at: now };
}

export async function listProjects(db: D1, ownerId: string): Promise<Project[]> {
  const result = await db.prepare(
    "SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC"
  ).bind(ownerId).all<Project>();
  return result.results;
}

export async function getProject(db: D1, id: string): Promise<ProjectWithRepositories | null> {
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<Project>();
  if (!project) return null;

  const repositories = await db.prepare(
    "SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at DESC"
  ).bind(id).all<Repository>();

  return { ...project, repositories: repositories.results };
}

export async function getProjectByName(db: D1, ownerId: string, name: string): Promise<Project | null> {
  return db.prepare("SELECT * FROM projects WHERE owner_id = ? AND name = ?").bind(ownerId, name).first<Project>();
}

export async function deleteProject(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function addRepository(db: D1, projectId: string, input: CreateRepositoryInput): Promise<Repository> {
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO repositories (id, project_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, projectId, input.name, input.url, now).run();

  return { id, project_id: projectId, name: input.name, url: input.url, created_at: now };
}

export async function listRepositories(db: D1, projectId: string): Promise<Repository[]> {
  const result = await db.prepare(
    "SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at DESC"
  ).bind(projectId).all<Repository>();
  return result.results;
}

export async function deleteRepository(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM repositories WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
