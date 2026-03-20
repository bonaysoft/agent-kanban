import type { Task, TaskLog, TaskWithLogs, CreateTaskInput } from "@agent-kanban/shared";
import { HTTPException } from "hono/http-exception";
import { newId, type D1 } from "./db";
import { getDefaultBoard, getColumnByBoardAndName } from "./boardRepo";
import { detectCycle, computeBlocked } from "./taskDeps";

// ─── Helpers ───

export async function getTaskWithBoard(db: D1, taskId: string): Promise<Task & { board_id: string }> {
  const row = await db.prepare(
    "SELECT t.*, c.board_id FROM tasks t JOIN columns c ON t.column_id = c.id WHERE t.id = ?"
  ).bind(taskId).first<Task & { board_id: string }>();
  if (!row) throw new HTTPException(404, { message: "Task not found" });
  return row;
}

// ─── CRUD ───

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
  const depsJson = input.depends_on?.length ? JSON.stringify(input.depends_on) : null;

  if (depsJson) {
    const hasCycle = await detectCycle(db, taskId, input.depends_on!);
    if (hasCycle) throw new HTTPException(400, { message: "Circular dependency detected" });
  }

  if (input.created_from) {
    const parent = await db.prepare("SELECT id FROM tasks WHERE id = ?").bind(input.created_from).first();
    if (!parent) throw new HTTPException(400, { message: "Parent task not found" });
  }

  await db.batch([
    db.prepare(`
      INSERT INTO tasks (id, column_id, title, description, project_id, labels, priority, created_by, assigned_to, result, pr_url, input, depends_on, created_from, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
    `).bind(
      taskId, todoColumn.id, input.title, input.description || null,
      input.project_id || null, labelsJson, input.priority || null,
      input.agentId || "human", inputJson, depsJson, input.created_from || null,
      (maxPos?.max_pos ?? -1) + 1, now, now,
    ),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'created', NULL, ?)"
    ).bind(logId, taskId, input.agentId || null, now),
  ]);

  return {
    id: taskId, column_id: todoColumn.id, title: input.title,
    description: input.description || null, project_id: input.project_id || null,
    labels: labelsJson, priority: input.priority || null,
    created_by: input.agentId || "human", assigned_to: null,
    result: null, pr_url: null, input: inputJson,
    depends_on: depsJson, created_from: input.created_from || null,
    position: (maxPos?.max_pos ?? -1) + 1, created_at: now, updated_at: now,
  };
}

export async function listTasks(
  db: D1,
  filters: { project_id?: string; status?: string; label?: string; board_id?: string; parent?: string },
): Promise<Task[]> {
  let query = `
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN columns c ON t.column_id = c.id
    JOIN boards b ON c.board_id = b.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE 1=1
  `;
  const binds: unknown[] = [];

  if (filters.board_id) {
    query += " AND b.id = ?";
    binds.push(filters.board_id);
  }
  if (filters.project_id) {
    query += " AND t.project_id = ?";
    binds.push(filters.project_id);
  }
  if (filters.status) {
    query += " AND c.name = ? COLLATE NOCASE";
    binds.push(filters.status);
  }
  if (filters.label) {
    query += " AND EXISTS (SELECT 1 FROM json_each(t.labels) WHERE json_each.value = ?)";
    binds.push(filters.label);
  }
  if (filters.parent) {
    query += " AND t.created_from = ?";
    binds.push(filters.parent);
  }

  query += " ORDER BY c.position, t.position";

  const stmt = db.prepare(query);
  const result = await (binds.length ? stmt.bind(...binds) : stmt).all<Task>();

  const tasks = result.results;
  const taskIds = tasks.filter((t: Task) => t.depends_on).map((t: Task) => t.id);
  if (taskIds.length > 0) {
    const blockedSet = await computeBlocked(db, taskIds);
    for (const task of tasks) {
      task.blocked = blockedSet.has(task.id);
    }
  }

  return tasks;
}

export async function getTask(db: D1, taskId: string): Promise<TaskWithLogs & { agent_name: string | null; subtask_count: number } | null> {
  const task = await db.prepare(`
    SELECT t.*, a.name as agent_name, p.name as project_name,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.created_from = t.id) as subtask_count
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_to = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `).bind(taskId).first<Task & { agent_name: string | null; subtask_count: number }>();
  if (!task) return null;

  const logs = await db.prepare(
    "SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC"
  ).bind(taskId).all<TaskLog>();

  const duration = computeDuration(logs.results);

  // Compute blocked status
  if (task.depends_on) {
    const blockedSet = await computeBlocked(db, [taskId]);
    task.blocked = blockedSet.has(taskId);
  }

  return { ...task, logs: logs.results, duration_minutes: duration };
}

export async function updateTask(db: D1, taskId: string, updates: Partial<Task>): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  if (updates.depends_on !== undefined) {
    const deps: string[] = updates.depends_on ? JSON.parse(updates.depends_on as string) : [];
    if (deps.length > 0) {
      const hasCycle = await detectCycle(db, taskId, deps);
      if (hasCycle) throw new HTTPException(400, { message: "Circular dependency detected" });
    }
  }

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];

  const allowedFields = ["title", "description", "project_id", "labels", "priority", "column_id", "result", "pr_url", "input", "depends_on"] as const;
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

// ─── Lifecycle ───

export async function claimTask(
  db: D1,
  taskId: string,
  agentId: string,
  inProgressColumnId: string,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.assigned_to) throw new HTTPException(409, { message: "Task is already claimed" });

  if (task.depends_on) {
    const blockedSet = await computeBlocked(db, [taskId]);
    if (blockedSet.has(taskId)) throw new HTTPException(409, { message: "Task is blocked by unfinished dependencies" });
  }

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

export async function releaseTask(
  db: D1,
  taskId: string,
  todoColumnId: string,
  agentId: string | null,
  action: "released" | "timed_out" = "released",
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET assigned_to = NULL, column_id = ?, updated_at = ? WHERE id = ?"
    ).bind(todoColumnId, now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
    ).bind(logId, taskId, agentId, action, now),
  ]);

  return { ...task, assigned_to: null, column_id: todoColumnId, updated_at: now };
}

export async function assignTask(
  db: D1,
  taskId: string,
  agentId: string,
  inProgressColumnId: string,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.assigned_to) throw new HTTPException(409, { message: "Task is already claimed" });

  if (task.depends_on) {
    const blockedSet = await computeBlocked(db, [taskId]);
    if (blockedSet.has(taskId)) throw new HTTPException(409, { message: "Task is blocked by unfinished dependencies" });
  }

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET assigned_to = ?, column_id = ?, updated_at = ? WHERE id = ? AND assigned_to IS NULL"
    ).bind(agentId, inProgressColumnId, now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'assigned', NULL, ?)"
    ).bind(logId, taskId, agentId, now),
  ]);

  return { ...task, assigned_to: agentId, column_id: inProgressColumnId, updated_at: now };
}

// ─── Logs ───

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

export async function getTaskLogs(db: D1, taskId: string, since?: string): Promise<TaskLog[]> {
  let query = "SELECT * FROM task_logs WHERE task_id = ?";
  const binds: unknown[] = [taskId];

  if (since) {
    query += " AND created_at > ?";
    binds.push(since);
  }

  query += " ORDER BY created_at ASC";

  const result = await db.prepare(query).bind(...binds).all<TaskLog>();
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
