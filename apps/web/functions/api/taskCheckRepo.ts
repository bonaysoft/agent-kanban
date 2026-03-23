import type { TaskCheck } from "@agent-kanban/shared";
import { newLongId, type D1 } from "./db";

export async function createCheck(
  db: D1,
  taskId: string,
  description: string,
): Promise<TaskCheck> {
  const id = newLongId();
  const now = new Date().toISOString();

  const maxOrder = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM task_checks WHERE task_id = ?",
  ).bind(taskId).first<{ max_order: number }>();

  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  await db.prepare(
    "INSERT INTO task_checks (id, task_id, description, passed, sort_order, created_at) VALUES (?, ?, ?, 0, ?, ?)",
  ).bind(id, taskId, description, sortOrder, now).run();

  return { id, task_id: taskId, description, passed: 0, verified_by: null, verified_at: null, sort_order: sortOrder, created_at: now };
}

export async function listChecks(
  db: D1,
  taskId: string,
): Promise<TaskCheck[]> {
  const result = await db.prepare(
    "SELECT * FROM task_checks WHERE task_id = ? ORDER BY sort_order ASC",
  ).bind(taskId).all<TaskCheck>();
  return result.results;
}

export async function updateCheck(
  db: D1,
  checkId: string,
  updates: { description?: string },
): Promise<TaskCheck | null> {
  const existing = await db.prepare("SELECT * FROM task_checks WHERE id = ?").bind(checkId).first<TaskCheck>();
  if (!existing) return null;

  if (updates.description !== undefined) {
    await db.prepare("UPDATE task_checks SET description = ? WHERE id = ?").bind(updates.description, checkId).run();
  }

  return { ...existing, ...updates };
}

export async function deleteCheck(
  db: D1,
  checkId: string,
): Promise<boolean> {
  const result = await db.prepare("DELETE FROM task_checks WHERE id = ?").bind(checkId).run();
  return result.meta.changes > 0;
}

export async function verifyCheck(
  db: D1,
  checkId: string,
  agentId: string,
  passed: boolean,
): Promise<TaskCheck | null> {
  const existing = await db.prepare("SELECT * FROM task_checks WHERE id = ?").bind(checkId).first<TaskCheck>();
  if (!existing) return null;

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE task_checks SET passed = ?, verified_by = ?, verified_at = ? WHERE id = ?",
  ).bind(passed ? 1 : 0, agentId, now, checkId).run();

  return { ...existing, passed: passed ? 1 : 0, verified_by: agentId, verified_at: now };
}

export async function checkAllPassed(
  db: D1,
  taskId: string,
): Promise<{ total: number; passed: number }> {
  const result = await db.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed FROM task_checks WHERE task_id = ?",
  ).bind(taskId).first<{ total: number; passed: number }>();
  return { total: result?.total ?? 0, passed: result?.passed ?? 0 };
}
