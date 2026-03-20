import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./types";
import { authMiddleware, generateApiKey, revokeApiKey, listApiKeys } from "./auth";
import { createBoard, listBoards, getBoard, deleteBoard, getColumnByBoardAndName, getDefaultBoard } from "./boardRepo";
import { createTask, listTasks, getTask, updateTask, deleteTask, claimTask, completeTask, addTaskLog, getTaskLogs } from "./taskRepo";
import { findOrCreateAgent } from "./agentRepo";

const api = new Hono<{ Bindings: Env }>();

// Error handler
api.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: { code: err.message, message: err.message } }, err.status);
  }
  if (err.message === "ALREADY_CLAIMED") {
    return c.json({ error: { code: "ALREADY_CLAIMED", message: "Task is already claimed" } }, 409);
  }
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: { code: "INTERNAL_ERROR", message: err.message || "Internal server error" } }, 500);
});

// Auth middleware for all routes except key creation check
api.use("/api/*", authMiddleware);

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
  const board = await getBoard(c.env.DB, c.req.param("id"));
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return c.json(board);
});

api.delete("/api/boards/:id", async (c) => {
  const deleted = await deleteBoard(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Board not found" });
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
  if (body.agent_name) {
    const apiKey = c.get("apiKey");
    const agent = await findOrCreateAgent(c.env.DB, apiKey.id, body.agent_name);
    agentId = agent.id;
  }

  const task = await createTask(c.env.DB, { ...body, agentId });
  return c.json(task, 201);
});

api.get("/api/tasks", async (c) => {
  const { project, status, label, board_id } = c.req.query();
  const tasks = await listTasks(c.env.DB, { project, status, label, board_id });
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

// ─── Claim / Complete ───

api.post("/api/tasks/:id/claim", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { agent_name?: string };
  const agentName = body.agent_name || `agent-${crypto.randomUUID().slice(0, 6)}`;
  const apiKey = c.get("apiKey");

  const agent = await findOrCreateAgent(c.env.DB, apiKey.id, agentName);

  // Find "In Progress" column for this task's board
  const taskRow = await c.env.DB.prepare(
    "SELECT t.*, c.board_id FROM tasks t JOIN columns c ON t.column_id = c.id WHERE t.id = ?"
  ).bind(c.req.param("id")).first<{ board_id: string }>();
  if (!taskRow) throw new HTTPException(404, { message: "Task not found" });

  const inProgressCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "In Progress");
  if (!inProgressCol) throw new HTTPException(500, { message: "In Progress column not found" });

  const task = await claimTask(c.env.DB, c.req.param("id"), agent.id, inProgressCol.id);
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

  const taskRow = await c.env.DB.prepare(
    "SELECT t.*, c.board_id FROM tasks t JOIN columns c ON t.column_id = c.id WHERE t.id = ?"
  ).bind(c.req.param("id")).first<{ board_id: string }>();
  if (!taskRow) throw new HTTPException(404, { message: "Task not found" });

  const doneCol = await getColumnByBoardAndName(c.env.DB, taskRow.board_id, "Done");
  if (!doneCol) throw new HTTPException(500, { message: "Done column not found" });

  const task = await completeTask(
    c.env.DB, c.req.param("id"), agentId, doneCol.id,
    body.result || null, body.pr_url || null,
  );
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

  const logs = await getTaskLogs(c.env.DB, c.req.param("id"));
  return c.json(logs);
});

// ─── Auth / Keys ───

api.post("/api/auth/keys", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}));
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
