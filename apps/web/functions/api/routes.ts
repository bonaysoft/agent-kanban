import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { authMiddleware, requireUser, requireMachine } from "./auth";
import { getBoard, listBoards, createBoard, getBoardByName, updateBoard, deleteBoard } from "./boardRepo";
import { createRepository, listRepositories, deleteRepository } from "./repositoryRepo";
import { createTask, listTasks, getTask, updateTask, deleteTask, claimTask, completeTask, releaseTask, assignTask, cancelTask, reviewTask, addTaskLog, getTaskLogs } from "./taskRepo";
import { ensureAgent, listAgents, getAgent, getAgentLogs, setAgentWorkingIfIdle, setAgentIdleIfNoActiveTasks, updateAgentUsage } from "./agentRepo";
import { detectAndReleaseStale } from "./taskStale";
import { createSSEResponse } from "./sse";
import { createMessage, listMessages } from "./messageRepo";
import { upsertMachineHeartbeat, listMachines, getMachine, createMachine, deleteMachine } from "./machineRepo";
import { createAuth } from "./betterAuth";

const api = new Hono<{ Bindings: Env }>();

// Error handler
api.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: { code: err.message, message: err.message } }, err.status);
  }
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: { code: "INTERNAL_ERROR", message: err.message || "Internal server error" } }, 500);
});

// Better Auth handler — must be before auth middleware
api.on(["GET", "POST"], "/api/auth/*", async (c) => {
  try {
    const auth = createAuth(c.env);
    return await auth.handler(c.req.raw);
  } catch (err: any) {
    console.error("better-auth error:", err.message, err.stack);
    return c.json({ error: { code: "AUTH_ERROR", message: err.message } }, 500);
  }
});

// Auth middleware for all routes except SSE and auth endpoints
api.use("/api/*", async (c, next) => {
  if (c.req.path.match(/\/api\/tasks\/[^/]+\/stream$/)) return next();
  if (c.req.path.startsWith("/api/auth/")) return next();
  return authMiddleware(c, next);
});

// ─── Machines ───

api.post("/api/machines/:id/heartbeat", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const body = await c.req.json<{ name: string; os?: string; version?: string; runtimes?: string[] }>();
  if (!body.name) throw new HTTPException(400, { message: "name is required" });
  const updated = await upsertMachineHeartbeat(c.env.DB, c.req.param("id"), body);
  return c.json(updated);
});

api.get("/api/machines", async (c) => {
  const machines = await listMachines(c.env.DB, c.get("ownerId"));
  return c.json(machines);
});

api.get("/api/machines/:id", async (c) => {
  const machine = await getMachine(c.env.DB, c.req.param("id"));
  if (!machine) throw new HTTPException(404, { message: "Machine not found" });
  return c.json(machine);
});

api.post("/api/machines", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const machine = await createMachine(c.env.DB, c.get("ownerId"), body.name || "unnamed");
  return c.json(machine, 201);
});

api.delete("/api/machines/:id", async (c) => {
  const guard = requireUser(c); if (guard) return guard;
  const deleted = await deleteMachine(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Machine not found" });
  return c.json({ ok: true });
});

// ─── Agents ───

api.get("/api/agents", async (c) => {
  const agents = await listAgents(c.env.DB);
  return c.json(agents);
});

api.get("/api/agents/:id", async (c) => {
  const agent = await getAgent(c.env.DB, c.req.param("id"));
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  const logs = await getAgentLogs(c.env.DB, c.req.param("id"));
  return c.json({ ...agent, logs });
});

api.patch("/api/agents/:id/usage", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const body = await c.req.json();
  await updateAgentUsage(c.env.DB, c.req.param("id"), body);
  return c.json({ ok: true });
});

// ─── Tasks ───

api.post("/api/tasks", async (c) => {
  const body = await c.req.json();
  if (!body.title) throw new HTTPException(400, { message: "title is required" });

  if (body.input !== undefined && body.input !== null && typeof body.input !== "object") {
    throw new HTTPException(400, { message: "input must be a JSON object or null" });
  }

  let agentId: string | undefined;
  if (body.agent_id && body.machine_id) {
    const agent = await ensureAgent(c.env.DB, body.machine_id, body.agent_id);
    agentId = agent.id;
  }

  const task = await createTask(c.env.DB, c.get("ownerId"), { ...body, agentId });
  return c.json(task, 201);
});

api.get("/api/tasks", async (c) => {
  const { repository_id, status, label, board_id, parent } = c.req.query();
  const tasks = await listTasks(c.env.DB, { repository_id, status, label, board_id, parent });
  return c.json(tasks);
});

api.get("/api/tasks/:id", async (c) => {
  const task = await getTask(c.env.DB, c.req.param("id"));
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return c.json(task);
});

api.patch("/api/tasks/:id", async (c) => {
  const body = await c.req.json();

  if (body.input !== undefined && body.input !== null && typeof body.input !== "object") {
    throw new HTTPException(400, { message: "input must be a JSON object or null" });
  }

  if (body.labels && Array.isArray(body.labels)) {
    body.labels = JSON.stringify(body.labels);
  }
  if (body.input && typeof body.input === "object") {
    body.input = JSON.stringify(body.input);
  }

  const task = await updateTask(c.env.DB, c.req.param("id"), body);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return c.json(task);
});

api.delete("/api/tasks/:id", async (c) => {
  const deleted = await deleteTask(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Task not found" });
  return c.json({ ok: true });
});

// ─── Task Lifecycle ───

api.post("/api/tasks/:id/claim", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const body = await c.req.json().catch(() => ({})) as { agent_id?: string; machine_id?: string };
  if (!body.machine_id) throw new HTTPException(400, { message: "machine_id is required" });
  const agentId = body.agent_id || crypto.randomUUID();

  const agent = await ensureAgent(c.env.DB, body.machine_id, agentId);
  const task = await claimTask(c.env.DB, c.req.param("id"), agent.id);
  await setAgentWorkingIfIdle(c.env.DB, agent.id);
  return c.json(task);
});

api.post("/api/tasks/:id/complete", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { result?: string; pr_url?: string; agent_id?: string; machine_id?: string };

  let agentId: string | null = null;
  if (body.agent_id && body.machine_id) {
    const agent = await ensureAgent(c.env.DB, body.machine_id!, body.agent_id);
    agentId = agent.id;
  }

  const existing = await c.env.DB.prepare("SELECT assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ assigned_to: string | null }>();

  const task = await completeTask(c.env.DB, c.req.param("id"), agentId, body.result || null, body.pr_url || null);

  const effectiveAgentId = agentId || existing?.assigned_to;
  if (effectiveAgentId) {
    await setAgentIdleIfNoActiveTasks(c.env.DB, effectiveAgentId);
  }

  return c.json(task);
});

api.post("/api/tasks/:id/release", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const existing = await c.env.DB.prepare("SELECT assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ assigned_to: string | null }>();
  if (!existing?.assigned_to) throw new HTTPException(400, { message: "Task is not claimed" });

  const task = await releaseTask(c.env.DB, c.req.param("id"), existing.assigned_to);
  await setAgentIdleIfNoActiveTasks(c.env.DB, existing.assigned_to);
  return c.json(task);
});

api.post("/api/tasks/:id/assign", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const body = await c.req.json<{ agent_id: string; machine_id: string }>();
  if (!body.agent_id) throw new HTTPException(400, { message: "agent_id is required" });
  if (!body.machine_id) throw new HTTPException(400, { message: "machine_id is required" });

  const agent = await ensureAgent(c.env.DB, body.machine_id, body.agent_id);

  const existing = await c.env.DB.prepare("SELECT board_id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ board_id: string }>();
  if (existing) {
    await detectAndReleaseStale(c.env.DB, existing.board_id);
  }

  const task = await assignTask(c.env.DB, c.req.param("id"), agent.id);
  return c.json(task);
});

api.post("/api/tasks/:id/cancel", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { agent_id?: string; machine_id?: string };

  let agentId: string | null = null;
  if (body.agent_id && body.machine_id) {
    const agent = await ensureAgent(c.env.DB, body.machine_id!, body.agent_id);
    agentId = agent.id;
  }

  const existing = await c.env.DB.prepare("SELECT status, assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ status: string; assigned_to: string | null }>();
  if (existing?.status === "done") throw new HTTPException(400, { message: "Cannot cancel a completed task" });

  const task = await cancelTask(c.env.DB, c.req.param("id"), agentId || existing?.assigned_to || null);

  const effectiveAgentId = agentId || existing?.assigned_to;
  if (effectiveAgentId) {
    await setAgentIdleIfNoActiveTasks(c.env.DB, effectiveAgentId);
  }

  return c.json(task);
});

api.post("/api/tasks/:id/review", async (c) => {
  const guard = requireMachine(c); if (guard) return guard;
  const body = await c.req.json().catch(() => ({})) as { agent_id?: string; pr_url?: string; machine_id?: string };

  let agentId: string | null = null;
  if (body.agent_id) {
    const agent = await ensureAgent(c.env.DB, body.machine_id!, body.agent_id);
    agentId = agent.id;
  }

  const existing = await c.env.DB.prepare("SELECT assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ assigned_to: string | null }>();

  const task = await reviewTask(c.env.DB, c.req.param("id"), agentId || existing?.assigned_to || null, body.pr_url || null);
  return c.json(task);
});

// ─── Task Logs ───

api.post("/api/tasks/:id/logs", async (c) => {
  const body = await c.req.json<{ detail: string; agent_id?: string; machine_id?: string }>();
  if (!body.detail) throw new HTTPException(400, { message: "detail is required" });

  let agentId: string | null = null;
  if (body.agent_id && body.machine_id) {
    const agent = await ensureAgent(c.env.DB, body.machine_id!, body.agent_id);
    agentId = agent.id;
  }

  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const log = await addTaskLog(c.env.DB, c.req.param("id"), agentId, "commented", body.detail);
  return c.json(log, 201);
});

api.get("/api/tasks/:id/logs", async (c) => {
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const since = c.req.query("since");
  const logs = await getTaskLogs(c.env.DB, c.req.param("id"), since || undefined);
  return c.json(logs);
});

// ─── Messages ───

api.post("/api/tasks/:id/messages", async (c) => {
  const body = await c.req.json<{ agent_id: string; role: string; content: string }>();
  if (!body.agent_id || !body.role || !body.content) {
    throw new HTTPException(400, { message: "agent_id, role, and content are required" });
  }
  if (body.role !== "human" && body.role !== "agent") {
    throw new HTTPException(400, { message: "role must be 'human' or 'agent'" });
  }

  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const message = await createMessage(c.env.DB, c.req.param("id"), body.agent_id, body.role, body.content);
  return c.json(message, 201);
});

api.get("/api/tasks/:id/messages", async (c) => {
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const since = c.req.query("since");
  const messages = await listMessages(c.env.DB, c.req.param("id"), since || undefined);
  return c.json(messages);
});

// ─── SSE Stream ───

api.get("/api/tasks/:id/stream", async (c) => {
  const token = c.req.query("token");
  if (!token) throw new HTTPException(400, { message: "token query param required" });

  const lastEventId = c.req.header("Last-Event-ID") || null;
  return createSSEResponse(c.env, c.req.param("id"), lastEventId, token);
});

// ─── Boards ───

api.post("/api/boards", async (c) => {
  const body = await c.req.json<{ name: string; description?: string }>();
  if (!body.name) throw new HTTPException(400, { message: "name is required" });
  const board = await createBoard(c.env.DB, c.get("ownerId"), body.name, body.description);
  return c.json(board, 201);
});

api.get("/api/boards", async (c) => {
  const ownerId = c.get("ownerId");
  const name = c.req.query("name");
  if (name) {
    const board = await getBoardByName(c.env.DB, ownerId, name);
    if (!board) throw new HTTPException(404, { message: "Board not found" });
    return c.json(board);
  }
  const boards = await listBoards(c.env.DB, ownerId);
  return c.json(boards);
});

api.get("/api/boards/:id", async (c) => {
  await detectAndReleaseStale(c.env.DB, c.req.param("id"));
  const board = await getBoard(c.env.DB, c.req.param("id"));
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return c.json(board);
});

api.patch("/api/boards/:id", async (c) => {
  const body = await c.req.json<{ name?: string; description?: string }>();
  const board = await updateBoard(c.env.DB, c.req.param("id"), body);
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return c.json(board);
});

api.delete("/api/boards/:id", async (c) => {
  const deleted = await deleteBoard(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Board not found" });
  return c.json({ ok: true });
});

// ─── Repositories ───

api.post("/api/repositories", async (c) => {
  const body = await c.req.json<{ name: string; url: string }>();
  if (!body.name || !body.url) {
    throw new HTTPException(400, { message: "name and url are required" });
  }
  const repository = await createRepository(c.env.DB, c.get("ownerId"), body);
  return c.json(repository, 201);
});

api.get("/api/repositories", async (c) => {
  const repositories = await listRepositories(c.env.DB, c.get("ownerId"));
  return c.json(repositories);
});

api.delete("/api/repositories/:id", async (c) => {
  const ownerId = c.get("ownerId");
  const repo = await c.env.DB.prepare("SELECT owner_id FROM repositories WHERE id = ?").bind(c.req.param("id")).first<{ owner_id: string }>();
  if (!repo) throw new HTTPException(404, { message: "Repository not found" });
  if (repo.owner_id !== ownerId) throw new HTTPException(403, { message: "Forbidden" });
  await deleteRepository(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

export { api };
