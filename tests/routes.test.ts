// @vitest-environment node

import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const BETTER_AUTH_URL = "http://localhost:8788";
const env = createTestEnv();
let mf: Miniflare;

async function apiRequest(method: string, path: string, body?: Record<string, unknown>, token?: string) {
  const { api } = await import("../apps/web/functions/api/routes");
  const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body && method !== "GET") init.body = JSON.stringify(body);
  return api.request(path, init, env);
}

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
});

afterAll(async () => {
  await mf.dispose();
});

describe("routes", () => {
  const userId = "routes-test-user";
  let apiKey: string;
  let userToken: string;
  let machineId: string;
  let agentId: string;
  let sessionId: string;
  let sessionPrivateKey: CryptoKey;
  let leaderAgentId: string;
  let leaderSessionId: string;
  let leaderSessionPrivateKey: CryptoKey;
  let boardId: string;

  async function createApiKeyForUser(userId: string): Promise<string> {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const auth = createAuth(env);
    const result = await auth.api.createApiKey({ body: { userId } });
    return result.key;
  }

  async function createUserSessionToken(): Promise<string> {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const auth = createAuth(env);
    const result = await auth.api.signUpEmail({
      body: { name: "Routes Test User", email: "routes-session@test.com", password: "test-password-123" },
    });
    if (!result.token) throw new Error("signUpEmail did not return a session token");
    return result.token;
  }

  async function signSessionJWT(): Promise<string> {
    return new SignJWT({ sub: sessionId, aid: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(sessionPrivateKey);
  }

  async function signLeaderSessionJWT(): Promise<string> {
    return new SignJWT({ sub: leaderSessionId, aid: leaderAgentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(leaderSessionPrivateKey);
  }

  beforeAll(async () => {
    await seedUser(env.DB, userId, "routes@test.com");
    apiKey = await createApiKeyForUser(userId);
    userToken = await createUserSessionToken();

    const machineRes = await apiRequest(
      "POST",
      "/api/machines",
      {
        name: "routes-machine",
        os: "darwin",
        version: "1.0.0",
        runtimes: ["Claude Code"],
      },
      apiKey,
    );
    expect(machineRes.status).toBe(201);
    machineId = ((await machineRes.json()) as { id: string }).id;

    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await createAgent(env.DB, userId, { name: "Routes Agent", runtime: "Claude Code" });
    agentId = agent.id;

    sessionId = randomUUID();
    const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    sessionPrivateKey = (keypair as any).privateKey;
    const pubJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);
    await apiRequest(
      "POST",
      `/api/agents/${agentId}/sessions`,
      {
        session_id: sessionId,
        session_public_key: pubJwk.x!,
      },
      apiKey,
    );

    // Create a leader agent and session for complete/cancel/reject tests
    const leaderAgent = await createAgent(env.DB, userId, { name: "Routes Leader Agent", runtime: "Claude Code", kind: "leader" });
    leaderAgentId = leaderAgent.id;

    leaderSessionId = randomUUID();
    const leaderKeypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    leaderSessionPrivateKey = (leaderKeypair as any).privateKey;
    const leaderPubJwk = await crypto.subtle.exportKey("jwk", (leaderKeypair as any).publicKey);
    await apiRequest(
      "POST",
      `/api/agents/${leaderAgentId}/sessions`,
      {
        session_id: leaderSessionId,
        session_public_key: leaderPubJwk.x!,
      },
      apiKey,
    );

    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, userId, "routes-board");
    boardId = board.id;
  });

  // ─── Auth ───

  it("returns 401 for missing token", async () => {
    const res = await apiRequest("GET", "/api/boards");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns X-RateLimit headers for API key requests", async () => {
    const res = await apiRequest("GET", "/api/boards", undefined, apiKey);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("600");
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
  });

  // ─── Error handler ───

  it("onError returns structured error for HTTPException", async () => {
    const res = await apiRequest("GET", "/api/boards/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
    expect(body.error.message).toBe("Board not found");
  });

  // ─── Boards ───

  it("POST /api/boards creates a board", async () => {
    const res = await apiRequest("POST", "/api/boards", { name: "Route Board", description: "Test" }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Route Board");
    expect(body.description).toBe("Test");
  });

  it("POST /api/boards requires name", async () => {
    const res = await apiRequest("POST", "/api/boards", { description: "No name" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("GET /api/boards lists boards", async () => {
    const res = await apiRequest("GET", "/api/boards", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/boards?name= finds board by name", async () => {
    const res = await apiRequest("GET", "/api/boards?name=Route Board", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Route Board");
  });

  it("GET /api/boards?name= returns 404 for unknown name", async () => {
    const res = await apiRequest("GET", "/api/boards?name=Nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  it("GET /api/boards/:id returns board with tasks", async () => {
    const res = await apiRequest("GET", `/api/boards/${boardId}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(boardId);
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it("GET /api/boards/:id returns 404 for unknown board", async () => {
    const res = await apiRequest("GET", "/api/boards/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/boards/:id updates board", async () => {
    const res = await apiRequest("PATCH", `/api/boards/${boardId}`, { name: "Updated Board" }, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Updated Board");
  });

  it("PATCH /api/boards/:id returns 404 for unknown board", async () => {
    const res = await apiRequest("PATCH", "/api/boards/nonexistent", { name: "X" }, apiKey);
    expect(res.status).toBe(404);
  });

  it("DELETE /api/boards/:id deletes board", async () => {
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, userId, "Delete Route Board");
    const res = await apiRequest("DELETE", `/api/boards/${board.id}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/boards/:id returns 404 for unknown board", async () => {
    const res = await apiRequest("DELETE", "/api/boards/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  // ─── Repositories ───

  it("POST /api/repositories creates a repository", async () => {
    const res = await apiRequest("POST", "/api/repositories", { name: "test-repo", url: "https://github.com/org/test-repo" }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("test-repo");
    expect(body.url).toBe("https://github.com/org/test-repo");
  });

  it("POST /api/repositories requires name and url", async () => {
    const res = await apiRequest("POST", "/api/repositories", { name: "no-url" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("GET /api/repositories lists repositories", async () => {
    const res = await apiRequest("GET", "/api/repositories", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/repositories?url= filters by URL", async () => {
    const res = await apiRequest("GET", "/api/repositories?url=https://github.com/org/test-repo", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE /api/repositories/:id deletes a repository", async () => {
    const { createRepository } = await import("../apps/web/functions/api/repositoryRepo");
    const repo = await createRepository(env.DB, userId, { name: "del-repo", url: "https://github.com/org/del-repo" });
    const res = await apiRequest("DELETE", `/api/repositories/${repo.id}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/repositories/:id returns 404 for unknown repo", async () => {
    const res = await apiRequest("DELETE", "/api/repositories/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  // ─── Agents ───

  it("GET /api/agents lists agents", async () => {
    const res = await apiRequest("GET", "/api/agents", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/agents/:id returns agent with logs", async () => {
    const res = await apiRequest("GET", `/api/agents/${agentId}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(agentId);
    expect(body).toHaveProperty("logs");
  });

  it("GET /api/agents/:id returns 404 for unknown agent", async () => {
    const res = await apiRequest("GET", "/api/agents/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  it("POST /api/agents creates an agent", async () => {
    const res = await apiRequest("POST", "/api/agents", { name: "New Route Agent" }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("New Route Agent");
  });

  it("POST /api/agents requires name", async () => {
    const res = await apiRequest("POST", "/api/agents", {}, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/agents rejects reserved role", async () => {
    const res = await apiRequest("POST", "/api/agents", { name: "Bad Role", role: "quality-goalkeeper" }, apiKey);
    expect(res.status).toBe(403);
  });

  // ─── Tasks ───

  it("POST /api/tasks creates a task", async () => {
    const res = await apiRequest("POST", "/api/tasks", { title: "Route Task", board_id: boardId, assigned_to: agentId }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Route Task");
  });

  it("POST /api/tasks requires title", async () => {
    const res = await apiRequest("POST", "/api/tasks", { board_id: boardId }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks rejects non-object input", async () => {
    const res = await apiRequest("POST", "/api/tasks", { title: "Bad Input", board_id: boardId, input: "string" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("GET /api/tasks lists tasks", async () => {
    const res = await apiRequest("GET", "/api/tasks", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/tasks/:id returns a task", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Get Task", board_id: boardId });
    const res = await apiRequest("GET", `/api/tasks/${task.id}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(task.id);
  });

  it("GET /api/tasks/:id returns 404 for unknown task", async () => {
    const res = await apiRequest("GET", "/api/tasks/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/tasks/:id updates a task", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Patch Task", board_id: boardId });
    const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, { title: "Patched" }, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Patched");
  });

  it("PATCH /api/tasks/:id returns 404 for unknown task", async () => {
    const res = await apiRequest("PATCH", "/api/tasks/nonexistent", { title: "X" }, apiKey);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/tasks/:id rejects non-object input", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Bad Patch", board_id: boardId });
    const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, { input: 42 }, apiKey);
    expect(res.status).toBe(400);
  });

  it("DELETE /api/tasks/:id deletes a task", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Delete Task", board_id: boardId });
    const res = await apiRequest("DELETE", `/api/tasks/${task.id}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/tasks/:id returns 404 for unknown task", async () => {
    const res = await apiRequest("DELETE", "/api/tasks/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  // ─── Task Lifecycle ───

  it("POST /api/tasks/:id/assign assigns a task to the calling leader agent", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Assign Task", board_id: boardId });
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/assign`, {}, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Route assigns to the calling agent (leader), not a body-provided agent_id
    expect(body.assigned_to).toBe(leaderAgentId);
  });

  it("POST /api/tasks/:id/complete completes a task", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Complete Task", board_id: boardId });
    await env.DB.prepare("UPDATE tasks SET status = 'in_review' WHERE id = ?").bind(task.id).run();
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/complete`, { result: "done" }, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("done");
  });

  it("POST /api/tasks/:id/release releases a task", async () => {
    const { createTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Release Task", board_id: boardId });
    await assignTask(env.DB, task.id, agentId);
    await env.DB.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").bind(task.id).run();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/release`, {}, apiKey);
    expect(res.status).toBe(200);
  });

  it("POST /api/tasks/:id/cancel cancels a task", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Cancel Task", board_id: boardId });
    await env.DB.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").bind(task.id).run();
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/cancel`, {}, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("cancelled");
  });

  it("POST /api/tasks/:id/reject rejects a task in review", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Reject Task", board_id: boardId });
    await env.DB.prepare("UPDATE tasks SET status = 'in_review' WHERE id = ?").bind(task.id).run();
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/reject`, {}, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("in_progress");
  });

  // ─── Task Notes ───

  it("POST /api/tasks/:id/notes creates a note", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Note Task", board_id: boardId });
    const res = await apiRequest("POST", `/api/tasks/${task.id}/notes`, { detail: "A note entry" }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.detail).toBe("A note entry");
  });

  it("POST /api/tasks/:id/notes requires detail", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Note Task 2", board_id: boardId });
    const res = await apiRequest("POST", `/api/tasks/${task.id}/notes`, {}, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/notes returns 404 for unknown task", async () => {
    const res = await apiRequest("POST", "/api/tasks/nonexistent/notes", { detail: "X" }, apiKey);
    expect(res.status).toBe(404);
  });

  it("GET /api/tasks/:id/notes returns notes", async () => {
    const { createTask, addTaskNote } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Get Notes Task", board_id: boardId });
    await addTaskNote(env.DB, task.id, null, "commented", "Test note");
    const res = await apiRequest("GET", `/api/tasks/${task.id}/notes`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/tasks/:id/notes returns 404 for unknown task", async () => {
    const res = await apiRequest("GET", "/api/tasks/nonexistent/notes", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  // ─── Messages ───

  it("POST /api/tasks/:id/messages creates a message", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Msg Task", board_id: boardId });
    const res = await apiRequest(
      "POST",
      `/api/tasks/${task.id}/messages`,
      {
        sender_type: "user",
        content: "Hello",
      },
      apiKey,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.content).toBe("Hello");
    expect(body.sender_type).toBe("user");
  });

  it("POST /api/tasks/:id/messages requires sender_type and content", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Msg Task 2", board_id: boardId });
    const res = await apiRequest("POST", `/api/tasks/${task.id}/messages`, { content: "No sender" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/messages rejects invalid sender_type", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Msg Task 3", board_id: boardId });
    const res = await apiRequest(
      "POST",
      `/api/tasks/${task.id}/messages`,
      {
        sender_type: "bot",
        content: "Bad type",
      },
      apiKey,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/messages returns 404 for unknown task", async () => {
    const res = await apiRequest(
      "POST",
      "/api/tasks/nonexistent/messages",
      {
        sender_type: "user",
        content: "X",
      },
      apiKey,
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/tasks/:id/messages returns messages", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const { createMessage } = await import("../apps/web/functions/api/messageRepo");
    const task = await createTask(env.DB, userId, { title: "Get Msg Task", board_id: boardId });
    await createMessage(env.DB, task.id, "user", userId, "Test msg");
    const res = await apiRequest("GET", `/api/tasks/${task.id}/messages`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/tasks/:id/messages returns 404 for unknown task", async () => {
    const res = await apiRequest("GET", "/api/tasks/nonexistent/messages", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  // ─── SSE Stream ───

  it("GET /api/tasks/:id/stream returns SSE response", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Stream Task", board_id: boardId });
    const res = await apiRequest("GET", `/api/tasks/${task.id}/stream`, undefined, apiKey);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  // ─── Machines ───

  it("GET /api/machines lists machines", async () => {
    const res = await apiRequest("GET", "/api/machines", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/machines/:id returns a machine", async () => {
    const res = await apiRequest("GET", `/api/machines/${machineId}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(machineId);
  });

  it("GET /api/machines/:id returns 404 for unknown machine", async () => {
    const res = await apiRequest("GET", "/api/machines/nonexistent", undefined, apiKey);
    expect(res.status).toBe(404);
  });

  it("POST /api/machines/:id/heartbeat updates machine", async () => {
    const res = await apiRequest("POST", `/api/machines/${machineId}/heartbeat`, { version: "2.0.0" }, apiKey);
    expect(res.status).toBe(200);
  });

  it("POST /api/machines/:id/heartbeat returns 404 for unknown machine", async () => {
    const res = await apiRequest("POST", "/api/machines/nonexistent/heartbeat", { version: "1.0.0" }, apiKey);
    expect(res.status).toBe(404);
  });

  it("POST /api/machines requires name, os, version, runtimes", async () => {
    const res = await apiRequest("POST", "/api/machines", { name: "incomplete" }, apiKey);
    expect(res.status).toBe(400);
  });

  // ─── Agent Sessions ───

  it("GET /api/agents/:agentId/sessions lists sessions", async () => {
    const res = await apiRequest("GET", `/api/agents/${agentId}/sessions`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /api/agents/:agentId/sessions requires fields", async () => {
    const res = await apiRequest("POST", `/api/agents/${agentId}/sessions`, {}, apiKey);
    expect(res.status).toBe(400);
  });

  it("DELETE /api/agents/:agentId/sessions/:sessionId closes session", async () => {
    const res = await apiRequest("DELETE", `/api/agents/${agentId}/sessions/${sessionId}`, undefined, apiKey);
    expect(res.status).toBe(200);
  });

  it("POST /api/agents/:agentId/sessions/:sessionId/reopen reopens session", async () => {
    const res = await apiRequest("POST", `/api/agents/${agentId}/sessions/${sessionId}/reopen`, {}, apiKey);
    expect(res.status).toBe(200);
  });

  // ─── Agent PATCH/DELETE ───

  it("PATCH /api/agents/:id returns 404 for nonexistent agent", async () => {
    const res = await apiRequest("PATCH", "/api/agents/nonexistent", { name: "X" }, userToken);
    expect(res.status).toBe(404);
  });

  it("DELETE /api/agents/:id deletes the agent", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const tempAgent = await createAgent(env.DB, userId, { name: "Temp Agent For Delete" });
    const res = await apiRequest("DELETE", `/api/agents/${tempAgent.id}`, undefined, userToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  // ─── Task claim forbidden for machine identity ───

  it("POST /api/tasks/:id/claim returns 403 for machine identity", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Claim Task", board_id: boardId });
    const res = await apiRequest("POST", `/api/tasks/${task.id}/claim`, {}, apiKey);
    expect(res.status).toBe(403);
  });

  // ─── Agent JWT claim flow ───

  it("POST /api/tasks/:id/claim works with agent JWT", async () => {
    await apiRequest("POST", `/api/agents/${agentId}/sessions/${sessionId}/reopen`, {}, apiKey);

    const { createTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Agent Claim Task", board_id: boardId });
    await assignTask(env.DB, task.id, agentId);
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/claim`, {}, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("in_progress");
  });

  it("POST /api/tasks/:id/review works with agent JWT", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Agent Review Task", board_id: boardId });
    await env.DB.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?").bind(agentId, task.id).run();
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/review`, {}, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("in_review");
  });

  // ─── Task assign with stale detection ───

  it("POST /api/tasks/:id/assign triggers stale detection", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Assign Stale Task", board_id: boardId });
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/assign`, { agent_id: agentId }, leaderJwt);
    expect(res.status).toBe(200);
  });
});
