import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { authMiddleware } from "./auth";
import { getBoard, listBoards, createBoard, getBoardByName, updateBoard, deleteBoard } from "./boardRepo";
import { createRepository, listRepositories, deleteRepository } from "./repositoryRepo";
import { createTask, listTasks, getTask, updateTask, deleteTask, claimTask, completeTask, releaseTask, assignTask, cancelTask, reviewTask, addTaskLog, getTaskLogs } from "./taskRepo";
import { createAgent, listAgents, getAgent, getAgentLogs, updateAgentUsage } from "./agentRepo";
import { detectAndReleaseStale } from "./taskStale";
import { createSSEResponse } from "./sse";
import { createMessage, listMessages } from "./messageRepo";
import { updateMachine, listMachines, getMachine, createMachine, deleteMachine } from "./machineRepo";
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
api.on(["GET", "POST"], "/api/auth/**", async (c) => {
  try {
    const auth = createAuth(c.env);
    return await auth.handler(c.req.raw);
  } catch (err: any) {
    console.error("better-auth error:", err.message, err.stack);
    return c.json({ error: { code: "AUTH_ERROR", message: err.message } }, 500);
  }
});

// Auth middleware for all API routes (except Better Auth's own endpoints)
api.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  return authMiddleware(c, next);
});

// ─── Machines ───

api.post("/api/machines/:id/heartbeat", async (c) => {
  const body = await c.req.json<{ version?: string; runtimes?: string[]; usage_info?: any }>();
  const updated = await updateMachine(c.env.DB, c.req.param("id"), c.get("ownerId"), body);
  if (!updated) throw new HTTPException(404, { message: "Machine not found" });
  return c.json(updated);
});

api.get("/api/machines", async (c) => {
  const machines = await listMachines(c.env.DB, c.get("ownerId"));
  return c.json(machines);
});

api.get("/api/machines/:id", async (c) => {
  const machine = await getMachine(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!machine) throw new HTTPException(404, { message: "Machine not found" });
  return c.json(machine);
});

api.post("/api/machines", async (c) => {

  const body = await c.req.json<{ name: string; os: string; version: string; runtimes: string[] }>();
  if (!body.name || !body.os || !body.version || !body.runtimes) {
    throw new HTTPException(400, { message: "name, os, version, and runtimes are required" });
  }
  const machine = await createMachine(c.env.DB, c.get("ownerId"), body);

  // Bind this API key to the machine via metadata, and create BA agentHost
  const auth = createAuth(c.env);
  const authCtx = await auth.$context;
  await authCtx.adapter.update({
    model: "apikey",
    where: [{ field: "id", value: c.get("apiKeyId")! }],
    update: { metadata: JSON.stringify({ machineId: machine.id }) },
  });
  const now = new Date();
  await authCtx.adapter.create({
    model: "agentHost",
    data: {
      id: machine.id,
      name: machine.name,
      userId: c.get("ownerId"),
      status: "active",
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    forceAllowId: true,
  });

  return c.json(machine, 201);
});

api.delete("/api/machines/:id", async (c) => {

  const machineId = c.req.param("id");
  const deleted = await deleteMachine(c.env.DB, machineId, c.get("ownerId"));
  if (!deleted) throw new HTTPException(404, { message: "Machine not found" });

  // Clean up BA data: delete agentHost (cascades to agent + agentCapabilityGrant via FK)
  const auth = createAuth(c.env);
  const authCtx = await auth.$context;
  await authCtx.adapter.delete({ model: "agentHost", where: [{ field: "id", value: machineId }] });

  return c.json({ ok: true });
});

// ─── Agents ───

api.get("/api/agents", async (c) => {
  const agents = await listAgents(c.env.DB, c.get("ownerId"));
  return c.json(agents);
});

api.get("/api/agents/:id", async (c) => {
  const agent = await getAgent(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  const logs = await getAgentLogs(c.env.DB, c.req.param("id"));
  return c.json({ ...agent, logs });
});

api.post("/api/agents", async (c) => {

  const body = await c.req.json<{ agent_id: string; public_key: string; runtime?: string; model?: string }>();
  if (!body.agent_id || !body.public_key) throw new HTTPException(400, { message: "agent_id and public_key are required" });
  const machineId = c.get("machineId");
  if (!machineId) throw new HTTPException(400, { message: "Machine not registered. Run ak start first." });

  // Write to custom agents table (business data)
  const agent = await createAgent(c.env.DB, machineId, body.agent_id, body.public_key, body.runtime, body.model);

  // Write to Better Auth agent table (auth data) so getAgentSession() works
  // machineId == agentHost.id (same ID shared between custom machines and BA hosts)
  const auth = createAuth(c.env);
  const authCtx = await auth.$context;
  const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: body.public_key });
  const now = new Date();
  await authCtx.adapter.create({
    model: "agent",
    data: {
      id: body.agent_id,
      name: agent.name,
      userId: c.get("ownerId") ?? null,
      hostId: machineId,
      status: "active",
      mode: "autonomous",
      publicKey: jwk,
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    forceAllowId: true,
  });

  // Grant all capabilities to the agent
  const capabilities = ["task:claim", "task:review", "task:log", "task:message", "agent:usage"];
  for (const cap of capabilities) {
    await authCtx.adapter.create({
      model: "agentCapabilityGrant",
      data: {
        agentId: body.agent_id,
        capability: cap,
        grantedBy: c.get("ownerId") ?? null,
        deniedBy: null,
        expiresAt: null,
        status: "active",
        reason: null,
        constraints: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  return c.json(agent, 201);
});

api.patch("/api/agents/:id/usage", async (c) => {

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

  const task = await createTask(c.env.DB, c.get("ownerId"), { ...body, agentId: body.agent_id });
  return c.json(task, 201);
});

api.get("/api/tasks", async (c) => {
  const { repository_id, status, label, board_id, parent, assigned_to } = c.req.query();
  const tasks = await listTasks(c.env.DB, { repository_id, status, label, board_id, parent, assigned_to });
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

  const body = await c.req.json().catch(() => ({})) as { agent_id?: string };
  const agentId = c.get("agentId") || body.agent_id;
  if (!agentId) throw new HTTPException(400, { message: "agent_id is required" });

  const task = await claimTask(c.env.DB, c.req.param("id"), agentId);
  return c.json(task);
});

api.post("/api/tasks/:id/complete", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { result?: string; pr_url?: string; agent_id?: string };
  const agentId = c.get("agentId") || body.agent_id;

  const task = await completeTask(c.env.DB, c.req.param("id"), agentId || null, body.result || null, body.pr_url || null);
  return c.json(task);
});

api.post("/api/tasks/:id/release", async (c) => {

  const existing = await c.env.DB.prepare("SELECT assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ assigned_to: string | null }>();
  if (!existing?.assigned_to) throw new HTTPException(400, { message: "Task is not claimed" });

  const task = await releaseTask(c.env.DB, c.req.param("id"), existing.assigned_to);
  return c.json(task);
});

api.post("/api/tasks/:id/assign", async (c) => {

  const body = await c.req.json<{ agent_id: string }>();
  const agentId = c.get("agentId") || body.agent_id;
  if (!agentId) throw new HTTPException(400, { message: "agent_id is required" });

  const existing = await c.env.DB.prepare("SELECT board_id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ board_id: string }>();
  if (existing) {
    await detectAndReleaseStale(c.env.DB, existing.board_id);
  }

  const task = await assignTask(c.env.DB, c.req.param("id"), agentId);
  return c.json(task);
});

api.post("/api/tasks/:id/cancel", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { agent_id?: string };
  const agentId = c.get("agentId") || body.agent_id;

  const existing = await c.env.DB.prepare("SELECT status, assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ status: string; assigned_to: string | null }>();
  if (existing?.status === "done") throw new HTTPException(400, { message: "Cannot cancel a completed task" });

  const task = await cancelTask(c.env.DB, c.req.param("id"), agentId || existing?.assigned_to || null);
  return c.json(task);
});

api.post("/api/tasks/:id/review", async (c) => {

  const body = await c.req.json().catch(() => ({})) as { agent_id?: string; pr_url?: string };
  const agentId = c.get("agentId") || body.agent_id;

  const existing = await c.env.DB.prepare("SELECT assigned_to FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first<{ assigned_to: string | null }>();

  const task = await reviewTask(c.env.DB, c.req.param("id"), agentId || existing?.assigned_to || null, body.pr_url || null);
  return c.json(task);
});

// ─── Task Logs ───

api.post("/api/tasks/:id/logs", async (c) => {
  const body = await c.req.json<{ detail: string; agent_id?: string }>();
  if (!body.detail) throw new HTTPException(400, { message: "detail is required" });

  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const agentId = c.get("agentId") || body.agent_id;
  const log = await addTaskLog(c.env.DB, c.req.param("id"), agentId || null, "commented", body.detail);
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
  const body = await c.req.json<{ agent_id?: string; role: string; content: string }>();
  const agentId = c.get("agentId") || body.agent_id;
  if (!agentId || !body.role || !body.content) {
    throw new HTTPException(400, { message: "agent_id, role, and content are required" });
  }
  if (body.role !== "human" && body.role !== "agent") {
    throw new HTTPException(400, { message: "role must be 'human' or 'agent'" });
  }

  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const message = await createMessage(c.env.DB, c.req.param("id"), agentId, body.role, body.content);
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
  const lastEventId = c.req.header("Last-Event-ID") || null;
  return createSSEResponse(c.env, c.req.param("id"), lastEventId);
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
