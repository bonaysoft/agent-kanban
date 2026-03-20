import type { Task, TaskLog, TaskWithLogs, CreateTaskInput } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";
import { getDefaultBoard, getColumnByBoardAndName } from "./boardRepo";

export async function createTask(db: D1, input: CreateTaskInput & { agentId?: string }): Promise<Task> {
  const board = input.board_id
    ? { id: input.board_id }
    : await getDefaultBoard(db);

  if (!board) throw new Error("No board exists. Create a board first.");

  const todoColumn = await getColumnByBoardAndName(db, board.id, "Todo");
  if (!todoColumn) throw new Error("Todo column not found on board.");

  const maxPos = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ?"
  ).bind(todoColumn.id).first<{ max_pos: number }>();

  const taskId = newId();
  const logId = newId();
  const now = new Date().toISOString();

  const labelsJson = input.labels ? JSON.stringify(input.labels) : null;
  const inputJson = input.input ? JSON.stringify(input.input) : null;

  await db.batch([
    db.prepare(`
      INSERT INTO tasks (id, column_id, title, description, project, labels, priority, created_by, assigned_to, result, pr_url, input, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    `).bind(
      taskId, todoColumn.id, input.title, input.description || null,
      input.project || null, labelsJson, input.priority || null,
      input.agentId || "human", inputJson,
      (maxPos?.max_pos ?? -1) + 1, now, now,
    ),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'created', NULL, ?)"
    ).bind(logId, taskId, input.agentId || null, now),
  ]);

  return {
    id: taskId, column_id: todoColumn.id, title: input.title,
    description: input.description || null, project: input.project || null,
    labels: labelsJson, priority: input.priority || null,
    created_by: input.agentId || "human", assigned_to: null,
    result: null, pr_url: null, input: inputJson,
    position: (maxPos?.max_pos ?? -1) + 1, created_at: now, updated_at: now,
  };
}

export async function listTasks(
  db: D1,
  filters: { project?: string; status?: string; label?: string; board_id?: string },
): Promise<Task[]> {
  let query = `
    SELECT t.* FROM tasks t
    JOIN columns c ON t.column_id = c.id
    JOIN boards b ON c.board_id = b.id
    WHERE 1=1
  `;
  const binds: unknown[] = [];

  if (filters.board_id) {
    query += " AND b.id = ?";
    binds.push(filters.board_id);
  }
  if (filters.project) {
    query += " AND t.project = ?";
    binds.push(filters.project);
  }
  if (filters.status) {
    query += " AND c.name = ? COLLATE NOCASE";
    binds.push(filters.status);
  }
  if (filters.label) {
    query += " AND EXISTS (SELECT 1 FROM json_each(t.labels) WHERE json_each.value = ?)";
    binds.push(filters.label);
  }

  query += " ORDER BY c.position, t.position";

  const stmt = db.prepare(query);
  const result = await (binds.length ? stmt.bind(...binds) : stmt).all<Task>();
  return result.results;
}

export async function getTask(db: D1, taskId: string): Promise<TaskWithLogs | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const logs = await db.prepare(
    "SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC"
  ).bind(taskId).all<TaskLog>();

  const duration = computeDuration(logs.results);

  return { ...task, logs: logs.results, duration_minutes: duration };
}

export async function updateTask(db: D1, taskId: string, updates: Partial<Task>): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];

  const allowedFields = ["title", "description", "project", "labels", "priority", "column_id", "result", "pr_url", "input"] as const;
  for (const field of allowedFields) {
    if (field in updates && updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      binds.push(updates[field]);
    }
  }

  binds.push(taskId);
  await db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  return { ...task, ...updates, updated_at: now };
}

export async function deleteTask(db: D1, taskId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId).run();
  return result.meta.changes > 0;
}

export async function claimTask(
  db: D1,
  taskId: string,
  agentId: string,
  inProgressColumnId: string,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.assigned_to) throw new Error("ALREADY_CLAIMED");

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET assigned_to = ?, column_id = ?, updated_at = ? WHERE id = ? AND assigned_to IS NULL"
    ).bind(agentId, inProgressColumnId, now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'claimed', NULL, ?)"
    ).bind(logId, taskId, agentId, now),
  ]);

  return { ...task, assigned_to: agentId, column_id: inProgressColumnId, updated_at: now };
}

export async function completeTask(
  db: D1,
  taskId: string,
  agentId: string | null,
  doneColumnId: string,
  result: string | null,
  prUrl: string | null,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET column_id = ?, result = ?, pr_url = ?, updated_at = ? WHERE id = ?"
    ).bind(doneColumnId, result, prUrl, now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'completed', ?, ?)"
    ).bind(logId, taskId, agentId, result, now),
  ]);

  return { ...task, column_id: doneColumnId, result, pr_url: prUrl, updated_at: now };
}

export async function addTaskLog(
  db: D1,
  taskId: string,
  agentId: string | null,
  action: string,
  detail: string | null,
): Promise<TaskLog> {
  const logId = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(logId, taskId, agentId, action, detail, now).run();

  return { id: logId, task_id: taskId, agent_id: agentId, action: action as any, detail, created_at: now };
}

export async function getTaskLogs(db: D1, taskId: string): Promise<TaskLog[]> {
  const result = await db.prepare(
    "SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC"
  ).bind(taskId).all<TaskLog>();
  return result.results;
}

function computeDuration(logs: TaskLog[]): number | null {
  const claimed = logs.find((l) => l.action === "claimed");
  const completed = logs.find((l) => l.action === "completed");
  if (!completed) return null;

  const start = claimed ? new Date(claimed.created_at) : null;
  const end = new Date(completed.created_at);

  if (!start) {
    const created = logs.find((l) => l.action === "created");
    if (!created) return null;
    return Math.round((end.getTime() - new Date(created.created_at).getTime()) / 60000);
  }

  return Math.round((end.getTime() - start.getTime()) / 60000);
}
