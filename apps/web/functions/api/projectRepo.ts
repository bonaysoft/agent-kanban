import type { Project, ProjectResource, ProjectWithResources, CreateResourceInput } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function createProject(db: D1, name: string, description?: string): Promise<Project> {
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, name, description || null, now, now).run();

  return { id, name, description: description || null, created_at: now, updated_at: now };
}

export async function listProjects(db: D1): Promise<Project[]> {
  const result = await db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all<Project>();
  return result.results;
}

export async function getProject(db: D1, id: string): Promise<ProjectWithResources | null> {
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<Project>();
  if (!project) return null;

  const resources = await db.prepare(
    "SELECT * FROM project_resources WHERE project_id = ? ORDER BY created_at DESC"
  ).bind(id).all<ProjectResource>();

  return { ...project, resources: resources.results };
}

export async function getProjectByName(db: D1, name: string): Promise<Project | null> {
  return db.prepare("SELECT * FROM projects WHERE name = ?").bind(name).first<Project>();
}

export async function deleteProject(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function addResource(db: D1, projectId: string, input: CreateResourceInput): Promise<ProjectResource> {
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO project_resources (id, project_id, type, name, uri, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, projectId, input.type, input.name, input.uri, input.config || null, now).run();

  return { id, project_id: projectId, type: input.type, name: input.name, uri: input.uri, config: input.config || null, created_at: now };
}

export async function listResources(db: D1, projectId: string): Promise<ProjectResource[]> {
  const result = await db.prepare(
    "SELECT * FROM project_resources WHERE project_id = ? ORDER BY created_at DESC"
  ).bind(projectId).all<ProjectResource>();
  return result.results;
}

export async function deleteResource(db: D1, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM project_resources WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
