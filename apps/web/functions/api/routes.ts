import { AGENT_RUNTIMES, type CreateAgentInput, isBoardType, isValidUsername, parseScheduledAt, RESERVED_ROLES } from "@agent-kanban/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createAgentIdentity,
  deleteAgent,
  getAgent,
  getAgentLogs,
  getAgentMailboxToken,
  insertAgent,
  listAgents,
  prepareAgent,
  updateAgent,
} from "./agentRepo";
import { closeSession, createSession, listSessions, reopenSession, updateSessionUsage } from "./agentSessionRepo";
import { authMiddleware } from "./auth";
import { createAuth } from "./betterAuth";
import { createBoard, deleteBoard, getBoard, getBoardByName, getBoardBySlug, listBoards, updateBoard } from "./boardRepo";
import { createBoardSSEResponse, createPublicBoardSSEResponse } from "./boardSSE";
import { addAgentEmail, getGithubToken, removeAgentEmail, syncGpgKey } from "./githubService";
import { getArmoredPrivateKey, getRootKeyInfo, getRootPublicKey, getSubkeyIds } from "./gpgKeyRepo";
import { createLogger } from "./logger";
import { deleteMachine, getMachine, listMachines, updateMachine, upsertMachine } from "./machineRepo";
import { createMailbox, deleteMailbox, getEmail, getInbox } from "./mailsService";
import { createMessage, listMessages } from "./messageRepo";
import { createRepository, deleteRepository, getRepository, listRepositories } from "./repositoryRepo";
import { createSSEResponse } from "./sse";
import { getSystemStats } from "./statsRepo";
import {
  addTaskAction,
  assignTask,
  cancelTask,
  claimTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  getTaskActions,
  listTasks,
  rejectTask,
  releaseTask,
  reviewTask,
  updateTask,
} from "./taskRepo";
import { detectAndReleaseStale } from "./taskStale";
import type { Env } from "./types";

const api = new Hono<{ Bindings: Env }>();
const logger = createLogger("api");

function resolveActor(c: { get: (key: string) => any }): { actorType: string; actorId: string } {
  const identity: string = c.get("identityType") || "machine";
  let actorId: string;
  if (identity === "user") actorId = c.get("ownerId") || "unknown";
  else if (identity === "machine") actorId = c.get("machineId") || c.get("apiKeyId") || "unknown";
  else actorId = c.get("agentId") || "unknown";
  return { actorType: identity, actorId };
}

// Access log
api.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const status = c.res.status;
  if (status >= 400) {
    logger.warn(`${c.req.method} ${c.req.path} ${status} ${Date.now() - start}ms`);
  }
});

// Error handler
api.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: { code: err.message, message: err.message } }, err.status);
  }
  logger.error(`${c.req.method} ${c.req.path} 500 ${err.message} ${err.stack}`);
  return c.json({ error: { code: "INTERNAL_ERROR", message: err.message || "Internal server error" } }, 500);
});

// Better Auth handler — must be before auth middleware
api.on(["GET", "POST"], "/api/auth/**", async (c) => {
  try {
    const auth = createAuth(c.env);
    return await auth.handler(c.req.raw);
  } catch (err: any) {
    logger.error(`better-auth error: ${err.message} ${err.stack}`);
    return c.json({ error: { code: "AUTH_ERROR", message: err.message } }, 500);
  }
});

api.get("/api/ping", (c) => c.json({ pong: true }));

// ─── Public Share Routes (no auth required) ───

api.get("/api/share/:slug", async (c) => {
  const board = await getBoardBySlug(c.env.DB, c.req.param("slug"));
  if (!board) throw new HTTPException(404, { message: "Board not found" });

  const publicTasks = board.tasks.map((t) => ({
    id: t.id,
    seq: t.seq,
    title: t.title,
    status: t.status,
    priority: t.priority,
    labels: t.labels,
    agent_name: t.agent_name,
    agent_public_key: t.agent_public_key,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));

  return c.json({ ...board, tasks: publicTasks });
});

api.get("/api/share/:slug/badge.svg", async (c) => {
  const board = await getBoardBySlug(c.env.DB, c.req.param("slug"));
  if (!board) throw new HTTPException(404, { message: "Board not found" });

  const counts = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
  for (const t of board.tasks) {
    if (t.status === "todo") counts.todo++;
    else if (t.status === "in_progress") counts.in_progress++;
    else if (t.status === "in_review") counts.in_review++;
    else if (t.status === "done") counts.done++;
  }

  function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  const label = escapeXml(board.name);
  const value = escapeXml(`${counts.todo} todo · ${counts.in_progress} active · ${counts.in_review} review · ${counts.done} done`);

  const labelWidth = Math.max(label.length * 7 + 16, 60);
  const valueWidth = value.length * 6.5 + 16;
  const totalWidth = labelWidth + valueWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#1e293b"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#0891b2"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
    },
  });
});

api.get("/api/sitemap.xml", async (c) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://agent-kanban.dev/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
  });
});

api.get("/api/share/:slug/stream", async (c) => {
  const board = await getBoardBySlug(c.env.DB, c.req.param("slug"));
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return createPublicBoardSSEResponse(c.env, board.id);
});

// Auth middleware for all API routes (except Better Auth's own endpoints)
api.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  return authMiddleware(c, next);
});

// ─── Machines ───

api.post("/api/machines/:id/heartbeat", async (c) => {
  const body = await c.req.json<{ version?: string; runtimes?: string[]; usage_info?: any }>();
  const machineId = c.req.param("id");
  const updated = await updateMachine(c.env.DB, machineId, c.get("ownerId"), body);
  if (!updated) throw new HTTPException(404, { message: "Machine not found" });

  // Bind API key to this machine if unbound; reject if bound to a different machine
  const boundMachineId = c.get("machineId");
  if (boundMachineId && boundMachineId !== machineId) {
    throw new HTTPException(403, { message: "API key is bound to a different machine" });
  }
  if (!boundMachineId) {
    const auth = createAuth(c.env);
    const authCtx = await auth.$context;
    await authCtx.adapter.update({
      model: "apikey",
      where: [{ field: "id", value: c.get("apiKeyId")! }],
      update: { metadata: JSON.stringify({ machineId }) },
    });
  }

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
  const body = await c.req.json<{ name: string; os: string; version: string; runtimes: string[]; device_id: string }>();
  if (!body.name || !body.os || !body.version || !body.runtimes || !body.device_id) {
    throw new HTTPException(400, { message: "name, os, version, runtimes, and device_id are required" });
  }
  const machine = await upsertMachine(c.env.DB, c.get("ownerId"), body);

  // Registration always binds the API key to the upserted machine
  const auth = createAuth(c.env);
  const authCtx = await auth.$context;
  await authCtx.adapter.update({
    model: "apikey",
    where: [{ field: "id", value: c.get("apiKeyId")! }],
    update: { metadata: JSON.stringify({ machineId: machine.id }) },
  });

  // Ensure BA agentHost exists (idempotent)
  const existing = await authCtx.adapter.findOne({ model: "agentHost", where: [{ field: "id", value: machine.id }] });
  if (!existing) {
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
  }

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
  const body = await c.req.json<{
    name: string;
    username: string;
    bio?: string;
    soul?: string;
    role?: string;
    kind?: "worker" | "leader";
    handoff_to?: string[];
    runtime: string;
    model?: string;
    skills?: string[];
  }>();
  if (!body.name) throw new HTTPException(400, { message: "name is required" });
  if (!body.username) throw new HTTPException(400, { message: "username is required" });
  if (!body.runtime) throw new HTTPException(400, { message: "runtime is required" });
  if (!isValidUsername(body.username)) throw new HTTPException(400, { message: `Invalid username "${body.username}"` });
  if (!AGENT_RUNTIMES.includes(body.runtime as any)) {
    throw new HTTPException(400, { message: `Invalid runtime "${body.runtime}". Must be one of: ${AGENT_RUNTIMES.join(", ")}` });
  }
  if (body.role && RESERVED_ROLES.has(body.role)) {
    throw new HTTPException(403, { message: `Role "${body.role}" is reserved for built-in agents` });
  }
  const ownerId = c.get("ownerId");

  // Validate username uniqueness before GPG mutation
  const taken = await c.env.DB.prepare("SELECT 1 FROM agents WHERE username = ?").bind(body.username).first();
  if (taken) throw new HTTPException(409, { message: `Username "${body.username}" is already taken` });

  // GPG subkey — its Ed25519 material becomes the agent's unified key
  const email = agentEmail(body.username);
  const identity = await createAgentIdentity(c.env.DB, ownerId, email);
  const prepared = await prepareAgent(c.env.DB, ownerId, body as CreateAgentInput, identity);

  // External service — create mailbox (skip if MAILS_ADMIN_TOKEN not configured)
  const mailboxToken = c.env.MAILS_ADMIN_TOKEN ? await createMailbox(c.env.MAILS_ADMIN_TOKEN, email) : undefined;

  try {
    // Single atomic insert with all fields
    const agent = await insertAgent(c.env.DB, prepared, {
      mailboxToken,
      gpgSubkeyId: identity.id.toUpperCase(),
    });

    // GitHub sync — best-effort, skip if not connected
    try {
      await syncToGithub(c.env, ownerId, email);
    } catch (err: unknown) {
      logger.warn(`github sync failed for agent ${agent.id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return c.json(agent, 201);
  } catch (err) {
    await deleteMailbox(c.env.MAILS_ADMIN_TOKEN, email).catch((cleanupErr: unknown) => {
      logger.warn(`mailbox cleanup failed for ${email}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    });
    throw err;
  }
});

api.patch("/api/agents/:id", async (c) => {
  const ownerId = c.get("ownerId");
  const existing = await getAgent(c.env.DB, c.req.param("id"), ownerId);
  if (!existing) throw new HTTPException(404, { message: "Agent not found" });
  if (existing.builtin) throw new HTTPException(403, { message: "Built-in agents cannot be modified" });
  const body = await c.req.json();
  const agent = await updateAgent(c.env.DB, c.req.param("id"), body);
  return c.json(agent);
});

api.delete("/api/agents/:id", async (c) => {
  const agent = await c.env.DB.prepare("SELECT id, username, builtin FROM agents WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string; username: string; builtin: number }>();
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  if (agent.builtin) throw new HTTPException(403, { message: "Built-in agents cannot be deleted" });
  const email = agentEmail(agent.username);
  await deleteAgent(c.env.DB, agent.id);
  if (c.env.MAILS_ADMIN_TOKEN) {
    await deleteMailbox(c.env.MAILS_ADMIN_TOKEN, email);
  }

  // Remove email from GitHub (best-effort)
  const token = await getGithubToken(c.env.DB, c.get("ownerId"));
  if (token) {
    await removeAgentEmail(token, email).catch((err: unknown) => {
      logger.warn(`github email cleanup failed for ${email}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return c.json({ ok: true });
});

// ─── Agent Sessions ───

api.post("/api/agents/:agentId/sessions", async (c) => {
  const body = await c.req.json<{ session_id: string; session_public_key: string }>();
  if (!body.session_id || !body.session_public_key) {
    throw new HTTPException(400, { message: "session_id and session_public_key are required" });
  }
  const machineId = c.get("machineId");
  if (!machineId) throw new HTTPException(400, { message: "Machine not registered" });

  const result = await createSession(c.env.DB, c.env, c.req.param("agentId"), machineId, body.session_id, body.session_public_key, c.get("ownerId"));
  return c.json(result, 201);
});

api.delete("/api/agents/:agentId/sessions/:sessionId", async (c) => {
  await closeSession(c.env.DB, c.req.param("sessionId"));
  return c.json({ ok: true });
});

api.post("/api/agents/:agentId/sessions/:sessionId/reopen", async (c) => {
  await reopenSession(c.env.DB, c.req.param("sessionId"));
  return c.json({ ok: true });
});

api.get("/api/agents/:agentId/sessions", async (c) => {
  const sessions = await listSessions(c.env.DB, c.req.param("agentId"));
  return c.json(sessions);
});

api.patch("/api/agents/:agentId/sessions/:sessionId/usage", async (c) => {
  const body = await c.req.json();
  await updateSessionUsage(c.env.DB, c.req.param("sessionId"), body);
  return c.json({ ok: true });
});

// ─── Tasks ───

api.post("/api/tasks", async (c) => {
  const body = await c.req.json();
  if (!body.title) throw new HTTPException(400, { message: "title is required" });
  if (!body.assigned_to) throw new HTTPException(400, { message: "assigned_to is required" });

  if (body.input !== undefined && body.input !== null && typeof body.input !== "object") {
    throw new HTTPException(400, { message: "input must be a JSON object or null" });
  }
  if (body.scheduled_at !== undefined && body.scheduled_at !== null) {
    const normalized = parseScheduledAt(body.scheduled_at);
    if (!normalized) throw new HTTPException(400, { message: "scheduled_at must be ISO 8601 with timezone (e.g. 2026-03-28T09:00:00Z)" });
    body.scheduled_at = normalized;
  }

  const { actorType, actorId } = resolveActor(c);
  const task = await createTask(c.env.DB, c.get("ownerId"), { ...body, actorType, actorId });
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
  if (body.scheduled_at !== undefined && body.scheduled_at !== null) {
    const normalized = parseScheduledAt(body.scheduled_at);
    if (!normalized) throw new HTTPException(400, { message: "scheduled_at must be ISO 8601 with timezone (e.g. 2026-03-28T09:00:00Z)" });
    body.scheduled_at = normalized;
  }

  // Workers can only update tasks they created
  if (c.get("identityType") === "agent:worker") {
    const existing = await c.env.DB.prepare("SELECT created_by FROM tasks WHERE id = ?").bind(c.req.param("id")).first<{ created_by: string }>();
    if (!existing) throw new HTTPException(404, { message: "Task not found" });
    if (existing.created_by !== c.get("agentId")) throw new HTTPException(403, { message: "Workers can only update tasks they created" });
  }

  const task = await updateTask(c.env.DB, c.req.param("id"), body);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return c.json(task);
});

api.delete("/api/tasks/:id", async (c) => {
  // Workers can only delete tasks they created
  if (c.get("identityType") === "agent:worker") {
    const existing = await c.env.DB.prepare("SELECT created_by FROM tasks WHERE id = ?").bind(c.req.param("id")).first<{ created_by: string }>();
    if (!existing) throw new HTTPException(404, { message: "Task not found" });
    if (existing.created_by !== c.get("agentId")) throw new HTTPException(403, { message: "Workers can only delete tasks they created" });
  }

  const deleted = await deleteTask(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Task not found" });
  return c.json({ ok: true });
});

// ─── Task Lifecycle ───

api.post("/api/tasks/:id/claim", async (c) => {
  const agentId = c.get("agentId");
  if (!agentId) throw new HTTPException(400, { message: "agent_id is required" });

  const task = await claimTask(c.env.DB, c.req.param("id"), agentId, c.get("identityType"));
  return c.json(task);
});

api.post("/api/tasks/:id/complete", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { result?: string; pr_url?: string };
  const { actorType, actorId } = resolveActor(c);

  const task = await completeTask(c.env.DB, c.req.param("id"), actorType, actorId, body.result || null, body.pr_url || null, c.get("identityType"));
  return c.json(task);
});

api.post("/api/tasks/:id/release", async (c) => {
  const { actorType, actorId } = resolveActor(c);
  const task = await releaseTask(c.env.DB, c.req.param("id"), actorType, actorId, c.get("identityType"));
  return c.json(task);
});

api.post("/api/tasks/:id/assign", async (c) => {
  const body = await c.req.json<{ agent_id: string }>();
  const targetAgentId = body.agent_id;
  if (!targetAgentId) throw new HTTPException(400, { message: "agent_id is required" });

  const existing = await c.env.DB.prepare("SELECT board_id FROM tasks WHERE id = ?").bind(c.req.param("id")).first<{ board_id: string }>();
  if (existing) {
    await detectAndReleaseStale(c.env.DB, existing.board_id);
  }

  const { actorType, actorId } = resolveActor(c);
  const task = await assignTask(c.env.DB, c.req.param("id"), targetAgentId, actorType, actorId);
  return c.json(task);
});

api.post("/api/tasks/:id/cancel", async (c) => {
  const { actorType, actorId } = resolveActor(c);
  const task = await cancelTask(c.env.DB, c.req.param("id"), actorType, actorId, c.get("identityType"));
  return c.json(task);
});

api.post("/api/tasks/:id/review", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { pr_url?: string };
  const { actorType, actorId } = resolveActor(c);

  const task = await reviewTask(c.env.DB, c.req.param("id"), actorType, actorId, body.pr_url || null, c.get("identityType"));
  return c.json(task);
});

api.post("/api/tasks/:id/reject", async (c) => {
  const { actorType, actorId } = resolveActor(c);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const task = await rejectTask(c.env.DB, c.req.param("id"), actorType, actorId, c.get("identityType"), body.reason);
  return c.json(task);
});

// ─── Task Notes ───

api.post("/api/tasks/:id/notes", async (c) => {
  const body = await c.req.json<{ detail: string }>();
  if (!body.detail) throw new HTTPException(400, { message: "detail is required" });

  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const { actorType, actorId } = resolveActor(c);
  const action = await addTaskAction(c.env.DB, c.req.param("id"), actorType, actorId, "commented", body.detail);
  return c.json(action, 201);
});

api.get("/api/tasks/:id/notes", async (c) => {
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const since = c.req.query("since");
  const actions = await getTaskActions(c.env.DB, c.req.param("id"), since || undefined);
  return c.json(actions);
});

// ─── Messages ───

api.post("/api/tasks/:id/messages", async (c) => {
  const body = await c.req.json<{ sender_type: string; sender_id?: string; content: string }>();
  if (!body.sender_type || !body.content) {
    throw new HTTPException(400, { message: "sender_type and content are required" });
  }
  if (body.sender_type !== "user" && body.sender_type !== "agent") {
    throw new HTTPException(400, { message: "sender_type must be 'user' or 'agent'" });
  }

  const senderId = body.sender_id || (body.sender_type === "agent" ? c.get("agentId") : c.get("ownerId"));
  if (!senderId) throw new HTTPException(400, { message: "sender_id is required" });

  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(c.req.param("id")).first();
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const message = await createMessage(c.env.DB, c.req.param("id"), body.sender_type, senderId, body.content);
  return c.json(message, 201);
});

api.get("/api/tasks/:id/messages", async (c) => {
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(c.req.param("id")).first();
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

api.get("/api/boards/:id/stream", async (c) => {
  return createBoardSSEResponse(c.env, c.req.param("id"), c.get("ownerId"));
});

// ─── Boards ───

api.post("/api/boards", async (c) => {
  const body = await c.req.json<{ name: string; description?: string; type: string }>();
  if (!body.name) throw new HTTPException(400, { message: "name is required" });
  if (!isBoardType(body.type)) throw new HTTPException(400, { message: "type must be 'dev' or 'ops'" });
  const board = await createBoard(c.env.DB, c.get("ownerId"), body.name, body.type, body.description);
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
  const body = await c.req.json<{ name?: string; description?: string; visibility?: "private" | "public" }>();
  const board = await updateBoard(c.env.DB, c.req.param("id"), body);
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return c.json(board);
});

api.delete("/api/boards/:id", async (c) => {
  const deleted = await deleteBoard(c.env.DB, c.req.param("id"));
  if (!deleted) throw new HTTPException(404, { message: "Board not found" });
  return c.json({ ok: true });
});

// ─── Admin ───

api.get("/api/admin/stats", async (c) => {
  if ((c.get("user") as any)?.role !== "admin") {
    return c.json({ error: { code: "FORBIDDEN", message: "Admin role required" } }, 403);
  }
  const stats = await getSystemStats(c.env.DB);
  return c.json(stats);
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
  const { url } = c.req.query();
  const repositories = await listRepositories(c.env.DB, c.get("ownerId"), { url });
  return c.json(repositories);
});

api.get("/api/repositories/:id", async (c) => {
  const repo = await getRepository(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!repo) throw new HTTPException(404, { message: "Repository not found" });
  return c.json(repo);
});

api.delete("/api/repositories/:id", async (c) => {
  const ownerId = c.get("ownerId");
  const repo = await c.env.DB.prepare("SELECT owner_id FROM repositories WHERE id = ?").bind(c.req.param("id")).first<{ owner_id: string }>();
  if (!repo) throw new HTTPException(404, { message: "Repository not found" });
  if (repo.owner_id !== ownerId) throw new HTTPException(403, { message: "Forbidden" });
  await deleteRepository(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

// ─── GPG Keys ───

api.get("/api/agents/:id/gpg-key", async (c) => {
  const agent = await c.env.DB.prepare("SELECT gpg_subkey_id FROM agents WHERE id = ? AND owner_id = ?")
    .bind(c.req.param("id"), c.get("ownerId"))
    .first<{ gpg_subkey_id: string | null }>();
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  const armoredPrivateKey = await getArmoredPrivateKey(c.env.DB, c.get("ownerId"));
  if (!armoredPrivateKey) throw new HTTPException(404, { message: "GPG key not found" });
  return c.json({ armored_private_key: armoredPrivateKey, gpg_subkey_id: agent.gpg_subkey_id });
});

api.get("/api/gpg/public-key", async (c) => {
  const armoredPublicKey = await getRootPublicKey(c.env.DB, c.get("ownerId"));
  if (!armoredPublicKey) throw new HTTPException(404, { message: "GPG root key not found" });
  return c.json({ armored_public_key: armoredPublicKey });
});

// ─── Agent Inbox ───

api.get("/api/agents/:id/inbox", async (c) => {
  const ownerId = c.get("ownerId");
  const agent = await getAgent(c.env.DB, c.req.param("id"), ownerId);
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  const mailboxToken = await getAgentMailboxToken(c.env.DB, agent.id);
  if (!mailboxToken) return c.json({ emails: [] });
  const emails = await getInbox(mailboxToken, agentEmail(agent.username));
  return c.json({ emails });
});

api.get("/api/agents/:id/inbox/:emailId", async (c) => {
  const ownerId = c.get("ownerId");
  const agent = await getAgent(c.env.DB, c.req.param("id"), ownerId);
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  const mailboxToken = await getAgentMailboxToken(c.env.DB, agent.id);
  if (!mailboxToken) throw new HTTPException(404, { message: "Mailbox not configured" });
  const email = await getEmail(mailboxToken, c.req.param("emailId"));
  return c.json(email);
});

export { api };

// ─── Helpers ───

function agentEmail(username: string): string {
  return `${username}@mails.agent-kanban.dev`;
}

async function syncToGithub(env: Env, ownerId: string, email: string): Promise<void> {
  const token = await getGithubToken(env.DB, ownerId);
  if (!token) return;

  const rootKey = await getRootKeyInfo(env.DB, ownerId);
  if (!rootKey) return;

  const subkeyIds = await getSubkeyIds(rootKey.armoredPublicKey);
  await syncGpgKey(token, rootKey.armoredPublicKey, rootKey.fingerprint, subkeyIds);
  await addAgentEmail(token, email);
}
