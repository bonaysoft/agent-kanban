import type { BoardAction, CreateTaskInput, IdentityType, Task, TaskAction, TaskActionType, TaskStatus, TaskWithNotes } from "@agent-kanban/shared";
import { validateTransition } from "@agent-kanban/shared";
import { HTTPException } from "hono/http-exception";
import { getDefaultBoard } from "./boardRepo";
import { type D1, newLongId, parseJsonFields } from "./db";
import { computeBlocked, detectCycle, getDependencies, setDependencies } from "./taskDeps";

const parseTask = <T extends Task>(row: T) => parseJsonFields(row, ["labels", "input"]);

function enforceTransition(action: TaskActionType, currentStatus: TaskStatus, identity: IdentityType): void {
  const error = validateTransition(action as any, currentStatus, identity);
  if (error) {
    const status = error.code === "FORBIDDEN" ? 403 : 409;
    throw new HTTPException(status, { message: error.message });
  }
}

async function assertAssignableWorkerAgent(db: D1, agentId: string, missingStatus: 400 | 404): Promise<void> {
  const agent = await db.prepare("SELECT kind FROM agents WHERE id = ?").bind(agentId).first<{ kind: string }>();
  if (!agent) throw new HTTPException(missingStatus, { message: "Agent not found" });
  if (agent.kind === "leader") throw new HTTPException(400, { message: "Cannot assign tasks to leader agents" });
}

export async function createTask(
  db: D1,
  ownerId: string,
  input: CreateTaskInput & { actorType?: string; actorId?: string; assigned_to?: string },
): Promise<Task> {
  const actorType = input.actorType ?? "machine";
  const actorId = input.actorId ?? "system";
  const board = input.board_id ? { id: input.board_id } : await getDefaultBoard(db, ownerId);

  if (!board) throw new HTTPException(400, { message: "No board exists. Create a board first." });

  const maxPos = await db
    .prepare("SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE board_id = ? AND status = 'todo'")
    .bind(board.id)
    .first<{ max_pos: number }>();

  const taskId = newLongId();
  const logId = newLongId();
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

  if (input.assigned_to) {
    await assertAssignableWorkerAgent(db, input.assigned_to, 400);
  }

  // Atomically allocate the next seq number via RETURNING
  const seqResult = await db
    .prepare("UPDATE boards SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq")
    .bind(board.id)
    .first<{ task_seq: number }>();
  const seq = seqResult!.task_seq;

  const stmts = [
    db
      .prepare(`
      INSERT INTO tasks (id, board_id, seq, status, title, description, repository_id, labels, priority, created_by, assigned_to, result, pr_url, input, created_from, position, created_at, updated_at)
      VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
    `)
      .bind(
        taskId,
        board.id,
        seq,
        input.title,
        input.description || null,
        input.repository_id || null,
        labelsJson,
        input.priority || null,
        actorId,
        input.assigned_to || null,
        inputJson,
        input.created_from || null,
        position,
        now,
        now,
      ),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'created', NULL, ?)")
      .bind(logId, taskId, actorType, actorId, now),
    ...(input.assigned_to
      ? [
          db
            .prepare(
              "INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'assigned', NULL, ?)",
            )
            .bind(newLongId(), taskId, actorType, actorId, now),
        ]
      : []),
    ...(input.depends_on || []).map((depId) => db.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)").bind(taskId, depId)),
  ];

  await db.batch(stmts);

  return {
    id: taskId,
    board_id: board.id,
    seq,
    status: "todo" as const,
    title: input.title,
    description: input.description || null,
    repository_id: input.repository_id || null,
    labels: input.labels || null,
    priority: input.priority || null,
    created_by: actorId,
    assigned_to: input.assigned_to || null,
    result: null,
    pr_url: null,
    input: input.input || null,
    created_from: input.created_from || null,
    position,
    created_at: now,
    updated_at: now,
  };
}

export async function listTasks(
  db: D1,
  filters: { repository_id?: string; status?: string; label?: string; board_id?: string; parent?: string; assigned_to?: string },
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
  if (filters.assigned_to) {
    query += " AND t.assigned_to = ?";
    binds.push(filters.assigned_to);
  }

  query += " ORDER BY t.position";

  const stmt = db.prepare(query);
  const result = await (binds.length ? stmt.bind(...binds) : stmt).all<Task>();
  const tasks = result.results.map(parseTask);

  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length > 0) {
    const blockedSet = await computeBlocked(db, taskIds);
    const placeholders = taskIds.map(() => "?").join(",");
    const depsResult = await db
      .prepare(`SELECT task_id, depends_on FROM task_dependencies WHERE task_id IN (${placeholders})`)
      .bind(...taskIds)
      .all<{ task_id: string; depends_on: string }>();
    const depsMap = new Map<string, string[]>();
    for (const row of depsResult.results) {
      const arr = depsMap.get(row.task_id) || [];
      arr.push(row.depends_on);
      depsMap.set(row.task_id, arr);
    }
    for (const task of tasks) {
      task.blocked = blockedSet.has(task.id);
      (task as any).depends_on = depsMap.get(task.id) || [];
    }
  }

  return tasks;
}

export async function getTask(db: D1, taskId: string): Promise<TaskWithNotes | null> {
  const task = await db
    .prepare(`
    SELECT t.*, a.name as agent_name, a.public_key as agent_public_key, a.fingerprint as agent_fingerprint,
      r.name as repository_name,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.created_from = t.id) as subtask_count
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_to = a.id
    LEFT JOIN repositories r ON t.repository_id = r.id
    WHERE t.id = ?
  `)
    .bind(taskId)
    .first<Task & { subtask_count: number }>();
  if (!task) return null;
  parseTask(task);

  const [actions, deps, blockedSet] = await Promise.all([
    db
      .prepare(
        "SELECT n.*, ag.name as actor_name, ag.public_key as actor_public_key FROM task_actions n LEFT JOIN agents ag ON n.actor_type LIKE 'agent:%' AND n.actor_id = ag.id WHERE n.task_id = ? ORDER BY n.created_at ASC",
      )
      .bind(taskId)
      .all<TaskAction>(),
    getDependencies(db, taskId),
    computeBlocked(db, [taskId]),
  ]);

  const duration = computeDuration(actions.results);
  task.blocked = blockedSet.has(taskId);

  return { ...task, notes: actions.results, duration_minutes: duration, depends_on: deps, subtask_count: task.subtask_count };
}

export async function updateTask(
  db: D1,
  taskId: string,
  updates: Partial<Pick<Task, "title" | "description" | "repository_id" | "labels" | "priority" | "result" | "pr_url" | "input" | "position">> & {
    depends_on?: string[];
  },
): Promise<Task | null> {
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

  const jsonFields = new Set(["labels", "input"]);
  const allowedFields = ["title", "description", "repository_id", "labels", "priority", "result", "pr_url", "input", "position"] as const;
  for (const field of allowedFields) {
    if (field in updates && (updates as any)[field] !== undefined) {
      sets.push(`${field} = ?`);
      const val = (updates as any)[field];
      binds.push(jsonFields.has(field) && val != null ? JSON.stringify(val) : val);
    }
  }

  binds.push(taskId);
  await db
    .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  return parseTask({ ...task, ...updates, updated_at: now } as Task);
}

export async function deleteTask(db: D1, taskId: string): Promise<boolean> {
  const task = await db
    .prepare("SELECT status, assigned_to FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ status: string; assigned_to: string | null }>();
  if (!task) return false;

  const canDelete = task.status === "todo" || task.status === "cancelled";
  if (!canDelete) {
    throw new HTTPException(409, { message: `Cannot delete task in ${task.status}${task.assigned_to ? " (assigned)" : ""} status` });
  }

  const result = await db.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId).run();
  return result.meta.changes > 0;
}

export async function claimTask(db: D1, taskId: string, agentId: string, identity: IdentityType): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.assigned_to !== agentId) throw new HTTPException(409, { message: "Task is not assigned to this agent" });
  enforceTransition("claim" as any, task.status as TaskStatus, identity);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").bind(now, taskId),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'claimed', NULL, ?)")
      .bind(logId, taskId, identity, agentId, now),
  ]);

  return parseTask({ ...task, status: "in_progress" as const, updated_at: now });
}

export async function assignTask(db: D1, taskId: string, targetAgentId: string, actorType: string, actorId: string): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  if (task.status !== "todo") throw new HTTPException(409, { message: "Can only assign tasks in todo status" });
  if (task.assigned_to) throw new HTTPException(409, { message: "Task is already assigned" });

  await assertAssignableWorkerAgent(db, targetAgentId, 404);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET assigned_to = ?, updated_at = ? WHERE id = ? AND assigned_to IS NULL").bind(targetAgentId, now, taskId),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'assigned', NULL, ?)")
      .bind(logId, taskId, actorType, actorId, now),
  ]);

  return parseTask({ ...task, assigned_to: targetAgentId, updated_at: now } as Task);
}

export async function completeTask(
  db: D1,
  taskId: string,
  actorType: string,
  actorId: string,
  result: string | null,
  prUrl: string | null,
  identity: IdentityType,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  enforceTransition("complete" as any, task.status as TaskStatus, identity);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET status = 'done', result = ?, pr_url = ?, updated_at = ? WHERE id = ?").bind(result, prUrl, now, taskId),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'completed', ?, ?)")
      .bind(logId, taskId, actorType, actorId, result, now),
  ]);

  return parseTask({ ...task, status: "done" as const, result, pr_url: prUrl, updated_at: now });
}

export async function cancelTask(db: D1, taskId: string, actorType: string, actorId: string, identity: IdentityType): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  enforceTransition("cancel" as any, task.status as TaskStatus, identity);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET status = 'cancelled', assigned_to = NULL, updated_at = ? WHERE id = ?").bind(now, taskId),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'cancelled', NULL, ?)")
      .bind(logId, taskId, actorType, actorId, now),
  ]);

  return parseTask({ ...task, status: "cancelled" as const, assigned_to: null, updated_at: now });
}

export async function reviewTask(
  db: D1,
  taskId: string,
  actorType: string,
  actorId: string,
  prUrl: string | null,
  identity: IdentityType,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  enforceTransition("review" as any, task.status as TaskStatus, identity);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET status = 'in_review', pr_url = COALESCE(?, pr_url), updated_at = ? WHERE id = ?").bind(prUrl, now, taskId),
    db
      .prepare(
        "INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'review_requested', NULL, ?)",
      )
      .bind(logId, taskId, actorType, actorId, now),
  ]);

  return parseTask({ ...task, status: "in_review" as const, pr_url: prUrl || task.pr_url, updated_at: now });
}

export async function releaseTask(
  db: D1,
  taskId: string,
  actorType: string,
  actorId: string,
  identity: IdentityType,
  action: "released" | "timed_out" = "released",
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  enforceTransition("release" as any, task.status as TaskStatus, identity);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET status = 'todo', updated_at = ? WHERE id = ?").bind(now, taskId),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
      .bind(logId, taskId, actorType, actorId, action, now),
  ]);

  return parseTask({ ...task, status: "todo" as const, updated_at: now });
}

export async function rejectTask(
  db: D1,
  taskId: string,
  actorType: string,
  actorId: string,
  identity: IdentityType,
  reason?: string,
): Promise<Task | null> {
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Task>();
  if (!task) return null;
  enforceTransition("reject" as any, task.status as TaskStatus, identity);

  const now = new Date().toISOString();
  const logId = newLongId();

  await db.batch([
    db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").bind(now, taskId),
    db
      .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, 'rejected', ?, ?)")
      .bind(logId, taskId, actorType, actorId, reason || null, now),
  ]);

  return parseTask({ ...task, status: "in_progress" as const, updated_at: now });
}

export async function addTaskAction(
  db: D1,
  taskId: string,
  actorType: string,
  actorId: string,
  action: string,
  detail: string | null,
): Promise<TaskAction> {
  const actionId = newLongId();
  const now = new Date().toISOString();

  await db
    .prepare("INSERT INTO task_actions (id, task_id, actor_type, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(actionId, taskId, actorType, actorId, action, detail, now)
    .run();

  return {
    id: actionId,
    task_id: taskId,
    actor_type: actorType as any,
    actor_id: actorId,
    actor_name: null,
    actor_public_key: null,
    action: action as any,
    detail,
    created_at: now,
  };
}

export async function getTaskActions(db: D1, taskId: string, since?: string): Promise<TaskAction[]> {
  let query =
    "SELECT n.*, ag.name as actor_name, ag.public_key as actor_public_key FROM task_actions n LEFT JOIN agents ag ON n.actor_type LIKE 'agent:%' AND n.actor_id = ag.id WHERE n.task_id = ?";
  const binds: unknown[] = [taskId];

  if (since) {
    query += " AND n.created_at > ?";
    binds.push(since);
  }

  query += " ORDER BY n.created_at ASC";

  const result = await db
    .prepare(query)
    .bind(...binds)
    .all<TaskAction>();
  return result.results;
}

export async function getBoardActionsByBoardId(db: D1, boardId: string, since: string): Promise<BoardAction[]> {
  const result = await db
    .prepare(`
      SELECT n.*, ag.name as actor_name, ag.public_key as actor_public_key, ag.kind as agent_kind
      FROM task_actions n
      JOIN tasks t ON n.task_id = t.id
      LEFT JOIN agents ag ON n.actor_type LIKE 'agent:%' AND n.actor_id = ag.id
      WHERE t.board_id = ? AND n.created_at > ?
      ORDER BY n.created_at ASC
      LIMIT 100
    `)
    .bind(boardId, since)
    .all<BoardAction>();
  return result.results;
}

export async function getBoardActions(db: D1, boardId: string, ownerId: string, since: string): Promise<BoardAction[]> {
  const result = await db
    .prepare(`
      SELECT n.*, ag.name as actor_name, ag.public_key as actor_public_key, ag.kind as agent_kind
      FROM task_actions n
      JOIN tasks t ON n.task_id = t.id
      JOIN boards b ON t.board_id = b.id
      LEFT JOIN agents ag ON n.actor_type LIKE 'agent:%' AND n.actor_id = ag.id
      WHERE t.board_id = ? AND b.owner_id = ? AND n.created_at > ?
      ORDER BY n.created_at ASC
      LIMIT 100
    `)
    .bind(boardId, ownerId, since)
    .all<BoardAction>();
  return result.results;
}

function computeDuration(actions: TaskAction[]): number | null {
  const claimed = actions.find((l) => l.action === "claimed");
  if (!claimed) return null;
  const end = actions.find((l) => l.action === "completed" || l.action === "cancelled");
  if (!end) return null;
  return Math.round((new Date(end.created_at).getTime() - new Date(claimed.created_at).getTime()) / 60000);
}
