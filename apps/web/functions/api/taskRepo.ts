import type { Task, TaskLog, TaskWithLogs, CreateTaskInput } from "@agent-kanban/shared";
import { HTTPException } from "hono/http-exception";
import { newId, type D1 } from "./db";
import { getDefaultBoard } from "./boardRepo";
import { detectCycle, computeBlocked, getDependencies, setDependencies } from "./taskDeps";

export async function createTask(db: D1, ownerId: string, input: CreateTaskInput & { agentId?: string }): Promise<Task> {
  const board = input.board_id
    ? { id: input.board_id }
    : await getDefaultBoard(db, ownerId);

  if (!board) throw new HTTPException(400, { message: "No board exists. Create a board first." });

  const maxPos = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE board_id = ? AND status = 'todo'"
  ).bind(board.id).first<{ max_pos: number }>();

  const taskId = newId();
  const logId = newId();
  const now = new Date().toISOString();
  const labelsJson = input.labels ? JSON.stringify(input.labels) : null;
  const inputJson = input.input ? JSON.stringify(input.input) : null;
  const position = (maxPos?.max_pos ?? -1) + 1;

  if (input.depends_on?.length) {
    const hasCycle = await detectCycle(db, taskId, input.depends_on);
    if (hasCycle) throw new HTTPException(400, { message: "Circular dependency detected" });
  }

  if (input.created_from) {
    const parent = await db.prepare("SELECT id FROM tasks WHERE id = ?").bind(input.created_from).first();
    if (!parent) throw new HTTPException(400, { message: "Parent task not found" });
  }

  const stmts = [
    db.prepare(`
      INSERT INTO tasks (id, board_id, status, title, description, repository_id, labels, priority, created_by, assigned_to, result, pr_url, input, created_from, position, created_at, updated_at)
      VALUES (?, ?, 'todo', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
    `).bind(
      taskId, board.id, input.title, input.description || null,
      input.repository_id || null, labelsJson, input.priority || null,
      input.agentId || "human", inputJson, input.created_from || null,
      position, now, now,
    ),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'created', NULL, ?)"
    ).bind(logId, taskId, input.agentId || null, now),
    ...(input.depends_on || []).map((depId) =>
      db.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").bind(taskId, depId)
    ),
  ];

  await db.batch(stmts);

  return {
    id: taskId, board_id: board.id, status: "todo", title: input.title,
    description: input.description || null, repository_id: input.repository_id || null,
    labels: labelsJson, priority: input.priority || null,
    created_by: input.agentId || "human", assigned_to: null,
    result: null, pr_url: null, input: inputJson,
    created_from: input.created_from || null,
    position, created_at: now, updated_at: now,
  };
}

export async function listTasks(
  db: D1,
  filters: { repository_id?: string; status?: string; label?: string; board_id?: string; parent?: string },
): Promise<Task[]> {
  let query = `
    SELECT t.*, r.name as repository_name FROM tasks t
    LEFT JOIN repositories r ON t.repository_id = r.id
    WHERE 1=1
  `;
  const binds: unknown[] = [];

  if (filters.board_id) {
    query += " AND t.board_id = ?";
    binds.push(filters.board_id);
  }
  if (filters.repository_id) {
    query += " AND t.repository_id = ?";
    binds.push(filters.repository_id);
  }
  if (filters.status) {
    query += " AND t.status = ?";
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

  query += " ORDER BY t.position";

  const stmt = db.prepare(query);
  const result = await (binds.length ? stmt.bind(...binds) : stmt).all<Task>();
  const tasks = result.results;

  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length > 0) {
    const blockedSet = await computeBlocked(db, taskIds);
    for (const task of tasks) {
      task.blocked = blockedSet.has(task.id);
    }
  }

  return tasks;
}

export async function getTask(db: D1, taskId: string): Promise<TaskWithLogs | null> {
  const task = await db.prepare(`
    SELECT t.*, a.name as agent_name, r.name as repository_name,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.created_from = t.id) as subtask_count
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_to = a.id
    LEFT JOIN repositories r ON t.repository_id = r.id
    WHERE t.id = ?
  `).bind(taskId).first<Task & { subtask_count: number }>();
  if (!task) return null;

  const [logs, deps, blockedSet] = await Promise.all([
    db.prepare("SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC").bind(taskId).all<TaskLog>(),
    getDependencies(db, taskId),
    computeBlocked(db, [taskId]),
  ]);

  const duration = computeDuration(logs.results);
  task.blocked = blockedSet.has(taskId);

  return { ...task, logs: logs.results, duration_minutes: duration, depends_on: deps, subtask_count: task.subtask_count };
}

export async function updateTask(db: D1, taskId: string, updates: Partial<Pick<Task, "title" | "description" | "repository_id" | "labels" | "priority" | "result" | "pr_url" | "input">> & { depends_on?: string[] }): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  if (updates.depends_on !== undefined) {
    if (updates.depends_on.length > 0) {
      const hasCycle = await detectCycle(db, taskId, updates.depends_on);
      if (hasCycle) throw new HTTPException(400, { message: "Circular dependency detected" });
    }
    await setDependencies(db, taskId, updates.depends_on);
  }

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];

  const allowedFields = ["title", "description", "repository_id", "labels", "priority", "result", "pr_url", "input"] as const;
  for (const field of allowedFields) {
    if (field in updates && (updates as any)[field] !== undefined) {
      sets.push(`${field} = ?`);
      binds.push((updates as any)[field]);
    }
  }

  binds.push(taskId);
  await db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  return { ...task, ...updates, updated_at: now } as Task;
}

export async function deleteTask(db: D1, taskId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId).run();
  return result.meta.changes > 0;
}

export async function claimTask(db: D1, taskId: string, agentId: string): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.assigned_to !== agentId) throw new HTTPException(409, { message: "Task is not assigned to this agent" });
  if (task.status !== "todo") throw new HTTPException(409, { message: "Task is not in todo status" });

  const now = new Date().toISOString();
  const logId = newId();

  // Claim moves the task to in_progress — agent confirms they are starting work
  await db.batch([
    db.prepare(
      "UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?"
    ).bind(now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'claimed', NULL, ?)"
    ).bind(logId, taskId, agentId, now),
  ]);

  return { ...task, status: "in_progress", updated_at: now };
}

export async function assignTask(db: D1, taskId: string, agentId: string): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.assigned_to) throw new HTTPException(409, { message: "Task is already assigned" });

  const blockedSet = await computeBlocked(db, [taskId]);
  if (blockedSet.has(taskId)) throw new HTTPException(409, { message: "Task is blocked by unfinished dependencies" });

  const now = new Date().toISOString();
  const logId = newId();

  // Assign only locks the task to the agent — status stays as-is (todo)
  await db.batch([
    db.prepare(
      "UPDATE tasks SET assigned_to = ?, updated_at = ? WHERE id = ? AND assigned_to IS NULL"
    ).bind(agentId, now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'assigned', NULL, ?)"
    ).bind(logId, taskId, agentId, now),
  ]);

  return { ...task, assigned_to: agentId, updated_at: now };
}

export async function completeTask(db: D1, taskId: string, agentId: string | null, result: string | null, prUrl: string | null): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET status = 'done', result = ?, pr_url = ?, updated_at = ? WHERE id = ?"
    ).bind(result, prUrl, now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'completed', ?, ?)"
    ).bind(logId, taskId, agentId, result, now),
  ]);

  return { ...task, status: "done", result, pr_url: prUrl, updated_at: now };
}

export async function cancelTask(db: D1, taskId: string, agentId: string | null): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET status = 'cancelled', assigned_to = NULL, updated_at = ? WHERE id = ?"
    ).bind(now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'cancelled', NULL, ?)"
    ).bind(logId, taskId, agentId, now),
  ]);

  return { ...task, status: "cancelled", assigned_to: null, updated_at: now };
}

export async function reviewTask(db: D1, taskId: string, agentId: string | null): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET status = 'in_review', updated_at = ? WHERE id = ?"
    ).bind(now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, 'review_requested', NULL, ?)"
    ).bind(logId, taskId, agentId, now),
  ]);

  return { ...task, status: "in_review", updated_at: now };
}

export async function releaseTask(db: D1, taskId: string, agentId: string | null, action: "released" | "timed_out" = "released"): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;

  const now = new Date().toISOString();
  const logId = newId();

  await db.batch([
    db.prepare(
      "UPDATE tasks SET assigned_to = NULL, status = 'todo', updated_at = ? WHERE id = ?"
    ).bind(now, taskId),
    db.prepare(
      "INSERT INTO task_logs (id, task_id, agent_id, action, detail, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
    ).bind(logId, taskId, agentId, action, now),
  ]);

  return { ...task, assigned_to: null, status: "todo", updated_at: now };
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

  const end = new Date(completed.created_at);

  if (claimed) {
    return Math.round((end.getTime() - new Date(claimed.created_at).getTime()) / 60000);
  }

  const created = logs.find((l) => l.action === "created");
  if (!created) return null;
  return Math.round((end.getTime() - new Date(created.created_at).getTime()) / 60000);
}
