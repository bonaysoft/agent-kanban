import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { authMiddleware, generateApiKey, revokeApiKey, listApiKeys } from "./auth";
import { createBoard, listBoards, getBoard, deleteBoard, getColumnByBoardAndName, getDefaultBoard } from "./boardRepo";
import { createTask, listTasks, getTask, updateTask, deleteTask, claimTask, completeTask, releaseTask, assignTask, cancelTask, reviewTask, addTaskLog, getTaskLogs, getTaskWithBoard } from "./taskRepo";
import { findOrCreateAgent, listAgents, getAgent, getAgentLogs, setAgentWorkingIfIdle, setAgentIdleIfNoActiveTasks } from "./agentRepo";
import { detectAndReleaseStale } from "./taskStale";
import { createSSEResponse } from "./sse";

const api = new Hono<{ Bindings: Env }>();

// Error handler
api.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: { code: err.message, message: err.message } }, err.status);
  }
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: { code: "INTERNAL_ERROR", message: err.message || "Internal server error" } }, 500);
});

// Auth middleware for all routes except SSE (uses token param)
api.use("/api/*", async (c, next) => {
  if (c.req.path.match(/\/api\/tasks\/[^/]+\/stream$/)) return next();
  return authMiddleware(c, next);
});

// ─── Boards ───

api.post("/api/boards", async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name) throw new HTTPException(400, { message: "name is required" });
  const board = await createBoard(c.env.DB, body.name);
  return c.json(board, 201);
});

api.get("/api/boards", async (c) => {
  const boards = await listBoards(c.env.DB);
  return c.json(boards);
});

api.get("/api/boards/:id", async (c) => {
  const boardId = c.req.param("id");
  // Write-on-read: auto-release stale claims
  await detectAndReleaseStale(c.env.DB, boardId);
  const board = await getBoard(c.env.DB, boardId);
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return c.json(board);
});

api.delete("/api/boards/:id", async (c) => {
  const deleted = await deleteBoard(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Board not found" });
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

// ─── Tasks ───

api.post("/api/tasks", async (c) => {
  const body = await c.req.json();
  if (!body.title) throw new HTTPException(400, { message: "title is required" });

  if (body.input !== undefined && body.input !== null && typeof body.input !== "object") {
    throw new HTTPException(400, { message: "input must be a JSON object or null" });
  }

  let agentId: string | undefined;
  if (body.agent_name) {
    const apiKey = c.get("apiKey");
    const agent = await findOrCreateAgent(c.env.DB, apiKey.id, body.agent_name);
    agentId = agent.id;
  }

  const task = await createTask(c.env.DB, { ...body, agentId });
  return c.json(task, 201);
});

api.get("/api/tasks", async (c) => {
  const { project, status, label, board_id, parent } = c.req.query();
  const tasks = await listTasks(c.env.DB, { project, status, label, board_id, parent });
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
  if (body.depends_on && Array.isArray(body.depends_on)) {
    body.depends_on = JSON.stringify(body.depends_on);
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

// ─── Claim / Complete / Assign / Release ───

api.post("/api/tasks/:id/claim", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { agent_name?: string };
  const agentName = body.agent_name || `agent-${crypto.randomUUID().slice(0, 6)}`;
  const apiKey = c.get("apiKey");

  const agent = await findOrCreateAgent(c.env.DB, apiKey.id, agentName);
  const taskRow = await getTaskWithBoard(c.env.DB, c.req.param("id"));
  const inProgressCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "In Progress");
  if (!inProgressCol) throw new HTTPException(500, { message: "In Progress column not found" });

  const task = await claimTask(c.env.DB, c.req.param("id"), agent.id, inProgressCol.id);
  await setAgentWorkingIfIdle(c.env.DB, agent.id);
  return c.json(task);
});

api.post("/api/tasks/:id/complete", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { result?: string; pr_url?: string; agent_name?: string };

  let agentId: string | null = null;
  if (body.agent_name) {
    const apiKey = c.get("apiKey");
    const agent = await findOrCreateAgent(c.env.DB, apiKey.id, body.agent_name);
    agentId = agent.id;
  }

  const taskRow = await getTaskWithBoard(c.env.DB, c.req.param("id"));
  const doneCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "Done");
  if (!doneCol) throw new HTTPException(500, { message: "Done column not found" });

  const task = await completeTask(
    c.env.DB, c.req.param("id"), agentId, doneCol.id,
    body.result || null, body.pr_url || null,
  );

  // Set agent idle if no other in-progress tasks
  const effectiveAgentId = agentId || taskRow.assigned_to;
  if (effectiveAgentId) {
    await setAgentIdleIfNoActiveTasks(c.env.DB, effectiveAgentId);
  }

  return c.json(task);
});

api.post("/api/tasks/:id/release", async (c) => {
  const taskRow = await getTaskWithBoard(c.env.DB, c.req.param("id"));
  if (!taskRow.assigned_to) throw new HTTPException(400, { message: "Task is not claimed" });

  const todoCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "Todo");
  if (!todoCol) throw new HTTPException(500, { message: "Todo column not found" });

  const agentId = taskRow.assigned_to;
  const task = await releaseTask(c.env.DB, c.req.param("id"), todoCol.id, agentId);
  await setAgentIdleIfNoActiveTasks(c.env.DB, agentId);
  return c.json(task);
});

api.post("/api/tasks/:id/assign", async (c) => {
  const body = await c.req.json<{ agent_id: string }>();
  if (!body.agent_id) throw new HTTPException(400, { message: "agent_id is required" });

  const taskRow = await getTaskWithBoard(c.env.DB, c.req.param("id"));

  // Inline stale detection before checking claimed state
  await detectAndReleaseStale(c.env.DB, taskRow.board_id);

  // Re-fetch task after stale detection may have released it
  const freshTask = await getTaskWithBoard(c.env.DB, c.req.param("id"));

  const inProgressCol = await getColumnByBoardAndName(c.env.DB, freshTask.board_id, "In Progress");
  if (!inProgressCol) throw new HTTPException(500, { message: "In Progress column not found" });

  const task = await assignTask(c.env.DB, c.req.param("id"), body.agent_id, inProgressCol.id);
  await setAgentWorkingIfIdle(c.env.DB, body.agent_id);
  return c.json(task);
});

api.post("/api/tasks/:id/cancel", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { agent_name?: string };

  let agentId: string | null = null;
  if (body.agent_name) {
    const apiKey = c.get("apiKey");
    const agent = await findOrCreateAgent(c.env.DB, apiKey.id, body.agent_name);
    agentId = agent.id;
  }

  const taskRow = await getTaskWithBoard(c.env.DB, c.req.param("id"));
  const cancelledCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "Cancelled");
  if (!cancelledCol) throw new HTTPException(500, { message: "Cancelled column not found" });

  const task = await cancelTask(c.env.DB, c.req.param("id"), cancelledCol.id, agentId || taskRow.assigned_to);

  const effectiveAgentId = agentId || taskRow.assigned_to;
  if (effectiveAgentId) {
    await setAgentIdleIfNoActiveTasks(c.env.DB, effectiveAgentId);
  }

  return c.json(task);
});

api.post("/api/tasks/:id/review", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { agent_name?: string };

  let agentId: string | null = null;
  if (body.agent_name) {
    const apiKey = c.get("apiKey");
    const agent = await findOrCreateAgent(c.env.DB, apiKey.id, body.agent_name);
    agentId = agent.id;
  }

  const taskRow = await getTaskWithBoard(c.env.DB, c.req.param("id"));
  const reviewCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "In Review");
  if (!reviewCol) throw new HTTPException(500, { message: "In Review column not found" });

  const task = await reviewTask(c.env.DB, c.req.param("id"), reviewCol.id, agentId || taskRow.assigned_to);
  return c.json(task);
});

// ─── Task Logs ───

api.post("/api/tasks/:id/logs", async (c) => {
  const body = await c.req.json<{ detail: string; agent_name?: string }>();
  if (!body.detail) throw new HTTPException(400, { message: "detail is required" });

  let agentId: string | null = null;
  if (body.agent_name) {
    const apiKey = c.get("apiKey");
    const agent = await findOrCreateAgent(c.env.DB, apiKey.id, body.agent_name);
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

// ─── SSE Stream ───

api.get("/api/tasks/:id/stream", async (c) => {
  const token = c.req.query("token");
  if (!token) throw new HTTPException(400, { message: "token query param required" });

  const lastEventId = c.req.header("Last-Event-ID") || null;
  return createSSEResponse(c.env.DB, c.req.param("id"), lastEventId, token);
});

// ─── Auth / Keys ───

api.post("/api/auth/keys", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const { key, record } = await generateApiKey(c.env.DB, body.name || null);
  return c.json({ key, id: record.id, name: record.name, created_at: record.created_at }, 201);
});

api.get("/api/auth/keys", async (c) => {
  const keys = await listApiKeys(c.env.DB);
  return c.json(keys);
});

api.delete("/api/auth/keys/:id", async (c) => {
  const deleted = await revokeApiKey(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "API key not found" });
  return c.json({ ok: true });
});

export { api };
