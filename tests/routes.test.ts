// @vitest-environment node

import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAgent, createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const BETTER_AUTH_URL = "http://localhost:8788";
const env = createTestEnv();
let mf: Miniflare;

async function apiRequest(method: string, path: string, body?: unknown, token?: string) {
  const { api } = await import("../apps/web/server/routes");
  const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
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
  let userTokenOwnerId: string;
  let machineId: string;
  let agentId: string;
  let sessionId: string;
  let sessionPrivateKey: CryptoKey;
  let leaderAgentId: string;
  let leaderSessionId: string;
  let leaderSessionPrivateKey: CryptoKey;
  let boardId: string;

  async function createApiKeyForUser(userId: string): Promise<string> {
    const { createAuth } = await import("../apps/web/server/betterAuth");
    const auth = createAuth(env);
    const result = await auth.api.createApiKey({ body: { userId } });
    return result.key;
  }

  async function createUserSessionToken(): Promise<{ token: string; userId: string }> {
    const { createAuth } = await import("../apps/web/server/betterAuth");
    const auth = createAuth(env);
    const result = await auth.api.signUpEmail({
      body: { name: "Routes Test User", email: "routes-session@test.com", password: "test-password-123" },
    });
    if (!result.token) throw new Error("signUpEmail did not return a session token");
    return { token: result.token, userId: result.user.id };
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
    const userSession = await createUserSessionToken();
    userToken = userSession.token;
    userTokenOwnerId = userSession.userId;

    const machineRes = await apiRequest(
      "POST",
      "/api/machines",
      {
        name: "routes-machine",
        os: "darwin",
        version: "1.0.0",
        runtimes: [{ name: "claude", status: "ready", checked_at: "2026-03-21T10:00:00Z" }],
        device_id: "test-device-routes",
      },
      apiKey,
    );
    expect(machineRes.status).toBe(201);
    machineId = ((await machineRes.json()) as { id: string }).id;
    const heartbeatRes = await apiRequest("POST", `/api/machines/${machineId}/heartbeat`, {}, apiKey);
    expect(heartbeatRes.status).toBe(200);

    const agent = await createTestAgent(env.DB, userId, { name: "Routes Agent", username: "routes-agent", runtime: "claude" });
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
    const leaderAgent = await createTestAgent(env.DB, userId, {
      name: "Routes Leader Agent",
      username: "routes-leader-agent",
      runtime: "claude",
      kind: "leader",
    });
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

    const { createBoard } = await import("../apps/web/server/boardRepo");
    const board = await createBoard(env.DB, userId, "routes-board", "ops");
    boardId = board.id;
  });

  // ─── Auth ───

  it("returns 401 for missing token", async () => {
    const res = await apiRequest("GET", "/api/boards");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("authenticates with API key", async () => {
    const res = await apiRequest("GET", "/api/boards", undefined, apiKey);
    expect(res.status).toBe(200);
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
    const res = await apiRequest("POST", "/api/boards", { name: "Route Board", type: "dev", description: "Test" }, userToken);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Route Board");
    expect(body.description).toBe("Test");
  });

  it("POST /api/boards requires name", async () => {
    const res = await apiRequest("POST", "/api/boards", { description: "No name" }, userToken);
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
    const res = await apiRequest("GET", "/api/boards?name=Route Board", undefined, userToken);
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
    const res = await apiRequest("PATCH", `/api/boards/${boardId}`, { name: "Updated Board" }, userToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Updated Board");
  });

  it("PATCH /api/boards/:id returns 404 for unknown board", async () => {
    const res = await apiRequest("PATCH", "/api/boards/nonexistent", { name: "X" }, userToken);
    expect(res.status).toBe(404);
  });

  it("DELETE /api/boards/:id deletes board", async () => {
    const { createBoard } = await import("../apps/web/server/boardRepo");
    const board = await createBoard(env.DB, userId, "Delete Route Board", "dev");
    const res = await apiRequest("DELETE", `/api/boards/${board.id}`, undefined, userToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/boards/:id returns 404 for unknown board", async () => {
    const res = await apiRequest("DELETE", "/api/boards/nonexistent", undefined, userToken);
    expect(res.status).toBe(404);
  });

  // ─── Repositories ───

  it("POST /api/repositories creates a repository", async () => {
    const res = await apiRequest("POST", "/api/repositories", { name: "test-repo", url: "https://github.com/org/test-repo" }, userToken);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("test-repo");
    expect(body.url).toBe("https://github.com/org/test-repo");
  });

  it("POST /api/repositories requires name and url", async () => {
    const res = await apiRequest("POST", "/api/repositories", { name: "no-url" }, userToken);
    expect(res.status).toBe(400);
  });

  it("GET /api/repositories lists repositories", async () => {
    const res = await apiRequest("GET", "/api/repositories", undefined, userToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/repositories?url= filters by URL", async () => {
    const res = await apiRequest("GET", "/api/repositories?url=https://github.com/org/test-repo", undefined, userToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE /api/repositories/:id deletes a repository", async () => {
    const { createRepository } = await import("../apps/web/server/repositoryRepo");
    const repo = await createRepository(env.DB, userId, { name: "del-repo", url: "https://github.com/org/del-repo" });
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("DELETE", `/api/repositories/${repo.id}`, undefined, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/repositories/:id returns 404 for unknown repo", async () => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("DELETE", "/api/repositories/nonexistent", undefined, jwt);
    expect(res.status).toBe(404);
  });

  it("POST /api/repositories rejects file:// URL with 400", async () => {
    const res = await apiRequest("POST", "/api/repositories", { name: "x", url: "file:///tmp/x" }, userToken);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toMatch(/file:\/\/\/tmp\/x/);
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
    const res = await apiRequest("POST", "/api/agents", { name: "New Route Agent", username: "new-route-agent", runtime: "claude" }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("New Route Agent");
    expect(body.runtime).toBe("claude");
  });

  it("POST /api/agents requires username", async () => {
    const res = await apiRequest("POST", "/api/agents", { runtime: "claude" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/agents requires runtime", async () => {
    const res = await apiRequest("POST", "/api/agents", { username: "no-runtime-agent" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/agents rejects invalid username format", async () => {
    const res = await apiRequest("POST", "/api/agents", { username: "My Invalid Agent!", runtime: "claude" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/agents rejects duplicate username", async () => {
    // First create succeeds
    const r1 = await apiRequest("POST", "/api/agents", { username: "dupe-agent", runtime: "claude" }, apiKey);
    expect(r1.status).toBe(201);
    // Same username second time → conflict
    const r2 = await apiRequest("POST", "/api/agents", { username: "dupe-agent", runtime: "claude" }, apiKey);
    expect(r2.status).toBe(409);
  });

  it("POST /api/agents returns username in response", async () => {
    const res = await apiRequest("POST", "/api/agents", { username: "username-check-agent", runtime: "claude" }, apiKey);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.username).toBe("username-check-agent");
  });

  it("POST /api/agents rejects a second leader for the same runtime", async () => {
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { username: "second-routes-leader", name: "Second Routes Leader", runtime: "claude", kind: "leader" },
      apiKey,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain('Leader agent for runtime "claude" already exists');
  });

  it("GET /api/agents returns email derived from username", async () => {
    const res = await apiRequest("GET", "/api/agents", undefined, apiKey);
    expect(res.status).toBe(200);
    const agents = (await res.json()) as any[];
    for (const agent of agents) {
      if (agent.username) {
        expect(agent.email).toBe(`${agent.username}@mails.agent-kanban.dev`);
      }
    }
  });

  it("GET /api/agents/:id returns email derived from username", async () => {
    const res = await apiRequest("GET", `/api/agents/${agentId}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.username).toBeTruthy();
    expect(body.email).toBe(`${body.username}@mails.agent-kanban.dev`);
  });

  it("POST /api/agents rejects reserved role", async () => {
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { name: "Bad Role", username: "bad-role", runtime: "claude", role: "quality-goalkeeper" },
      apiKey,
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/agents rejects malformed skill refs", async () => {
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { name: "Bad Skill", username: "bad-skill", runtime: "claude", skills: ["agent-kanban"] },
      apiKey,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain('Invalid skill "agent-kanban"');
  });

  it("POST /api/agents stores registered worker subagent IDs", async () => {
    const subagent = await createTestAgent(env.DB, userId, {
      name: "Create Route Subagent",
      username: "create-route-subagent",
      runtime: "claude",
    });
    const res = await apiRequest(
      "POST",
      "/api/agents",
      {
        name: "Subagent Route Agent",
        username: "subagent-route-agent",
        runtime: "claude",
        subagents: [subagent.id],
      },
      apiKey,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.subagents).toEqual([subagent.id]);
  });

  it("POST /api/agents rejects nonexistent subagent IDs", async () => {
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { name: "Missing Subagent", username: "missing-subagent", runtime: "claude", subagents: [randomUUID()] },
      apiKey,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain("is not registered");
  });

  it("POST /api/agents rejects leader subagent IDs", async () => {
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { name: "Leader Subagent", username: "leader-subagent", runtime: "claude", subagents: [leaderAgentId] },
      apiKey,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain("must be a worker agent");
  });

  it("POST /api/agents rejects cross-owner subagent IDs", async () => {
    const otherAgent = await createTestAgent(env.DB, userTokenOwnerId, {
      name: "Other Owner Subagent",
      username: "other-owner-subagent",
      runtime: "claude",
    });
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { name: "Cross Owner Subagent", username: "cross-owner-subagent", runtime: "claude", subagents: [otherAgent.id] },
      apiKey,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain("is not registered");
  });

  it("POST /api/agents rejects unsupported runtimes with subagents", async () => {
    const subagent = await createTestAgent(env.DB, userId, {
      name: "Unsupported Runtime Subagent",
      username: "unsupported-runtime-subagent",
      runtime: "claude",
    });
    const res = await apiRequest(
      "POST",
      "/api/agents",
      { name: "Gemini Subagents", username: "gemini-subagents", runtime: "gemini", subagents: [subagent.id] },
      apiKey,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain('Runtime "gemini" does not support subagents yet');
  });

  it("PATCH /api/agents/:id rejects malformed skill refs", async () => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", `/api/agents/${agentId}`, { skills: ["trailofbits/skills"] }, jwt);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain('Invalid skill "trailofbits/skills"');
  });

  it("PATCH /api/agents/:id rejects invalid runtime", async () => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", `/api/agents/${agentId}`, { runtime: "bogus" }, jwt);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain('Invalid runtime "bogus"');
  });

  it.each([null, "name-only", 7])("PATCH /api/agents/:id rejects %s JSON body", async (body) => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", `/api/agents/${agentId}`, body, jwt);

    expect(res.status).toBe(400);
    const payload = (await res.json()) as any;
    expect(payload.error.message).toBe("agent update must be a JSON object");
  });

  it("PATCH /api/agents/:id stores registered worker subagent IDs", async () => {
    const jwt = await signLeaderSessionJWT();
    const subagent = await createTestAgent(env.DB, userId, {
      name: "Patch Route Subagent",
      username: "patch-route-subagent",
      runtime: "claude",
    });
    const res = await apiRequest("PATCH", `/api/agents/${agentId}`, { subagents: [subagent.id] }, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.subagents).toEqual([subagent.id]);
    expect(body).not.toHaveProperty("private_key");
    expect(body).not.toHaveProperty("mailbox_token");
  });

  it("PATCH /api/agents/:id rejects self-reference as a subagent", async () => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", `/api/agents/${agentId}`, { subagents: [agentId] }, jwt);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain("Agent cannot include itself as a subagent");
  });

  // ─── Tasks ───

  it("POST /api/tasks creates a task", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", "/api/tasks", { title: "Route Task", board_id: boardId, assigned_to: agentId }, jwt);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Route Task");
  });

  it("POST /api/tasks requires title", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", "/api/tasks", { board_id: boardId }, jwt);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks rejects non-object input", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", "/api/tasks", { title: "Bad Input", board_id: boardId, input: "string" }, jwt);
    expect(res.status).toBe(400);
  });

  it("GET /api/tasks lists tasks", async () => {
    const res = await apiRequest("GET", "/api/tasks", undefined, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/tasks/:id returns a task", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
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
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Patch Task", board_id: boardId });
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, { title: "Patched" }, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Patched");
  });

  it("PATCH /api/tasks/:id returns 404 for unknown task", async () => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", "/api/tasks/nonexistent", { title: "X" }, jwt);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/tasks/:id rejects non-object input", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Bad Patch", board_id: boardId });
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, { input: 42 }, jwt);
    expect(res.status).toBe(400);
  });

  it("DELETE /api/tasks/:id deletes a task", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Delete Task", board_id: boardId });
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("DELETE", `/api/tasks/${task.id}`, undefined, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/tasks/:id returns 404 for unknown task", async () => {
    const jwt = await signLeaderSessionJWT();
    const res = await apiRequest("DELETE", "/api/tasks/nonexistent", undefined, jwt);
    expect(res.status).toBe(404);
  });

  // ─── Task Lifecycle ───

  it("POST /api/tasks/:id/assign assigns a task to a worker agent via leader", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Assign Task", board_id: boardId });
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/assign`, { agent_id: agentId }, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.assigned_to).toBe(agentId);
    expect(body).not.toHaveProperty("board_owner_id");
  });

  it("POST /api/tasks/:id/assign rejects leader agents (400)", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Leader Assign Task", board_id: boardId });
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/assign`, {}, leaderJwt);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/complete completes a task", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Complete Task", board_id: boardId });
    await env.DB.prepare("UPDATE tasks SET status = 'in_review' WHERE id = ?").bind(task.id).run();
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/complete`, { result: "done" }, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("done");
  });

  it("POST /api/tasks/:id/release releases a task", async () => {
    const { createTask, assignTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Release Task", board_id: boardId });
    await assignTask(env.DB, task.id, agentId, "machine", "system");
    await env.DB.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").bind(task.id).run();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/release`, {}, apiKey);
    expect(res.status).toBe(200);
  });

  it("POST /api/tasks/:id/cancel cancels a task", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Cancel Task", board_id: boardId });
    await env.DB.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").bind(task.id).run();
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/cancel`, {}, leaderJwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("cancelled");
  });

  it("POST /api/tasks/:id/reject rejects a task in review", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
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
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Note Task", board_id: boardId });
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/notes`, { detail: "A note entry" }, jwt);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.detail).toBe("A note entry");
  });

  it("POST /api/tasks/:id/notes requires detail", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Note Task 2", board_id: boardId });
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/notes`, {}, jwt);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/notes returns 404 for unknown task", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", "/api/tasks/nonexistent/notes", { detail: "X" }, jwt);
    expect(res.status).toBe(404);
  });

  it("GET /api/tasks/:id/notes returns notes", async () => {
    const { createTask, addTaskAction } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Get Notes Task", board_id: boardId });
    await addTaskAction(env.DB, task.id, "machine", "system", "commented", "Test note");
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
    const { createBoard } = await import("../apps/web/server/boardRepo");
    const { createTask } = await import("../apps/web/server/taskRepo");
    const userBoard = await createBoard(env.DB, userTokenOwnerId, "msg-board", "ops");
    const task = await createTask(env.DB, userTokenOwnerId, { title: "Msg Task", board_id: userBoard.id });
    const res = await apiRequest(
      "POST",
      `/api/tasks/${task.id}/messages`,
      {
        sender_type: "user",
        content: "Hello",
      },
      userToken,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.content).toBe("Hello");
    expect(body.sender_type).toBe("user");
  });

  it("POST /api/tasks/:id/messages requires sender_type and content", async () => {
    const { createBoard } = await import("../apps/web/server/boardRepo");
    const { createTask } = await import("../apps/web/server/taskRepo");
    const userBoard = await createBoard(env.DB, userTokenOwnerId, "msg-board-2", "ops");
    const task = await createTask(env.DB, userTokenOwnerId, { title: "Msg Task 2", board_id: userBoard.id });
    const res = await apiRequest("POST", `/api/tasks/${task.id}/messages`, { content: "No sender" }, userToken);
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks/:id/messages rejects invalid sender_type", async () => {
    const { createBoard } = await import("../apps/web/server/boardRepo");
    const { createTask } = await import("../apps/web/server/taskRepo");
    const userBoard = await createBoard(env.DB, userTokenOwnerId, "msg-board-3", "ops");
    const task = await createTask(env.DB, userTokenOwnerId, { title: "Msg Task 3", board_id: userBoard.id });
    const res = await apiRequest(
      "POST",
      `/api/tasks/${task.id}/messages`,
      {
        sender_type: "bot",
        content: "Bad type",
      },
      userToken,
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
      userToken,
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/tasks/:id/messages returns messages", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const { createMessage } = await import("../apps/web/server/messageRepo");
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
    const { createTask } = await import("../apps/web/server/taskRepo");
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

  it("POST /api/machines/:id/heartbeat rejects a machine API key bound to another machine without mutating the target", async () => {
    const { upsertMachine } = await import("../apps/web/server/machineRepo");
    const target = await upsertMachine(env.DB, userId, {
      name: "routes-target-machine",
      os: "linux",
      version: "1.0.0",
      runtimes: [{ name: "codex", status: "ready", checked_at: "2026-03-21T10:00:00Z" }],
      device_id: `routes-target-device-${randomUUID()}`,
    });
    const before = await env.DB.prepare("SELECT status, version, runtimes, last_heartbeat_at FROM machines WHERE id = ?")
      .bind(target.id)
      .first<any>();

    const res = await apiRequest(
      "POST",
      `/api/machines/${target.id}/heartbeat`,
      {
        version: "9.9.9",
        runtimes: [{ name: "claude", status: "limited", reset_at: "2026-03-21T11:00:00Z", checked_at: "2026-03-21T10:30:00Z" }],
      },
      apiKey,
    );
    const body = (await res.json()) as any;
    const after = await env.DB.prepare("SELECT status, version, runtimes, last_heartbeat_at FROM machines WHERE id = ?").bind(target.id).first<any>();

    expect(res.status).toBe(403);
    expect(body.error.message).toContain("API key is bound to a different machine");
    expect(after).toEqual(before);
  });

  it("POST /api/machines/:id/heartbeat rejects invalid runtime status with 400", async () => {
    const res = await apiRequest(
      "POST",
      `/api/machines/${machineId}/heartbeat`,
      { runtimes: [{ name: "claude", status: "busy", checked_at: "2026-03-21T10:00:00Z" }] },
      apiKey,
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.error.message).toContain('Invalid runtime status "busy"');
  });

  it("POST /api/machines/:id/heartbeat rejects invalid runtime name with 400", async () => {
    const res = await apiRequest(
      "POST",
      `/api/machines/${machineId}/heartbeat`,
      { runtimes: [{ name: "bad-runtime", status: "ready", checked_at: "2026-03-21T10:00:00Z" }] },
      apiKey,
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.error.message).toContain('Invalid runtime "bad-runtime"');
  });

  it("POST /api/machines/:id/heartbeat returns 404 for unknown machine", async () => {
    const unboundApiKey = await createApiKeyForUser(userId);
    const res = await apiRequest("POST", "/api/machines/nonexistent/heartbeat", { version: "1.0.0" }, unboundApiKey);
    expect(res.status).toBe(404);
  });

  it("POST /api/machines requires name, os, version, runtimes", async () => {
    const res = await apiRequest("POST", "/api/machines", { name: "incomplete" }, apiKey);
    expect(res.status).toBe(400);
  });

  it("POST /api/machines rejects invalid runtime status with 400", async () => {
    const res = await apiRequest(
      "POST",
      "/api/machines",
      {
        name: "invalid-runtime-status-machine",
        os: "darwin",
        version: "1.0.0",
        runtimes: [{ name: "claude", status: "busy", checked_at: "2026-03-21T10:00:00Z" }],
        device_id: "invalid-runtime-status-device",
      },
      apiKey,
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.error.message).toContain('Invalid runtime status "busy"');
  });

  it("POST /api/machines rejects invalid runtime name with 400", async () => {
    const res = await apiRequest(
      "POST",
      "/api/machines",
      {
        name: "invalid-runtime-name-machine",
        os: "darwin",
        version: "1.0.0",
        runtimes: [{ name: "bad-runtime", status: "ready", checked_at: "2026-03-21T10:00:00Z" }],
        device_id: "invalid-runtime-name-device",
      },
      apiKey,
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.error.message).toContain('Invalid runtime "bad-runtime"');
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

  it("POST /api/agents/:agentId/sessions/:sessionId/reopen returns 404 for nonexistent session", async () => {
    const nonexistentSessionId = randomUUID();
    const res = await apiRequest("POST", `/api/agents/${agentId}/sessions/${nonexistentSessionId}/reopen`, {}, apiKey);
    expect(res.status).toBe(404);
  });

  it("POST /api/agents/:agentId/sessions/:sessionId/reopen is idempotent when session is already active", async () => {
    // Create a fresh session that starts active (status='active', closed_at=NULL)
    const freshSessionId = randomUUID();
    const freshKeypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const freshPubJwk = await crypto.subtle.exportKey("jwk", (freshKeypair as any).publicKey);
    await apiRequest("POST", `/api/agents/${agentId}/sessions`, { session_id: freshSessionId, session_public_key: freshPubJwk.x! }, apiKey);

    // Inject a sentinel closed_at while keeping status='active'. This state is not reachable
    // via the public API — it exists solely to discriminate the no-op path from an erroneous
    // UPDATE: if reopen runs the UPDATE it would set closed_at to NULL, failing the assertion;
    // if it correctly skips the UPDATE the sentinel value survives unchanged.
    const sentinelClosedAt = "2000-01-01T00:00:00.000Z";
    await env.DB.prepare("UPDATE agent_sessions SET closed_at = ? WHERE id = ?").bind(sentinelClosedAt, freshSessionId).run();

    const res = await apiRequest("POST", `/api/agents/${agentId}/sessions/${freshSessionId}/reopen`, {}, apiKey);
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT status, closed_at FROM agent_sessions WHERE id = ?")
      .bind(freshSessionId)
      .first<{ status: string; closed_at: string | null }>();
    expect(row?.status).toBe("active");
    // The sentinel must survive — proves the UPDATE branch was skipped entirely
    expect(row?.closed_at).toBe(sentinelClosedAt);
  });

  it("POST /api/agents/:agentId/sessions/:sessionId/reopen clears closed_at after close", async () => {
    // Create a session, close it, then reopen and verify closed_at is cleared
    const freshSessionId = randomUUID();
    const freshKeypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const freshPubJwk = await crypto.subtle.exportKey("jwk", (freshKeypair as any).publicKey);
    await apiRequest("POST", `/api/agents/${agentId}/sessions`, { session_id: freshSessionId, session_public_key: freshPubJwk.x! }, apiKey);

    await apiRequest("DELETE", `/api/agents/${agentId}/sessions/${freshSessionId}`, undefined, apiKey);

    const closedRow = await env.DB.prepare("SELECT status, closed_at FROM agent_sessions WHERE id = ?")
      .bind(freshSessionId)
      .first<{ status: string; closed_at: string | null }>();
    expect(closedRow?.status).toBe("closed");
    expect(closedRow?.closed_at).not.toBeNull();

    const res = await apiRequest("POST", `/api/agents/${agentId}/sessions/${freshSessionId}/reopen`, {}, apiKey);
    expect(res.status).toBe(200);

    const reopenedRow = await env.DB.prepare("SELECT status, closed_at FROM agent_sessions WHERE id = ?")
      .bind(freshSessionId)
      .first<{ status: string; closed_at: string | null }>();
    expect(reopenedRow?.status).toBe("active");
    expect(reopenedRow?.closed_at).toBeNull();
  });

  // ─── Agent PATCH/DELETE ───

  it("PATCH /api/agents/:id returns 404 for nonexistent agent", async () => {
    const res = await apiRequest("PATCH", "/api/agents/nonexistent", { name: "X" }, userToken);
    expect(res.status).toBe(404);
  });

  it("DELETE /api/agents/:id deletes the agent", async () => {
    const tempAgent = await createTestAgent(env.DB, userTokenOwnerId, {
      name: "Temp Agent For Delete",
      username: "temp-agent-for-delete",
      runtime: "claude",
    });
    const res = await apiRequest("DELETE", `/api/agents/${tempAgent.id}`, undefined, userToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("DELETE /api/agents/:id rejects agents referenced as subagents", async () => {
    const referenced = await createTestAgent(env.DB, userTokenOwnerId, {
      name: "Referenced Delete Subagent",
      username: "referenced-delete-subagent",
      runtime: "claude",
    });
    await createTestAgent(env.DB, userTokenOwnerId, {
      name: "Referencing Delete Agent",
      username: "referencing-delete-agent",
      runtime: "claude",
      subagents: [referenced.id],
    });

    const res = await apiRequest("DELETE", `/api/agents/${referenced.id}`, undefined, userToken);
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.message).toContain("referenced as a subagent");
  });

  // ─── Task claim forbidden for machine identity ───

  it("POST /api/tasks/:id/claim returns 403 for machine identity", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Claim Task", board_id: boardId });
    const res = await apiRequest("POST", `/api/tasks/${task.id}/claim`, {}, apiKey);
    expect(res.status).toBe(403);
  });

  // ─── Agent JWT claim flow ───

  it("POST /api/tasks/:id/claim works with agent JWT", async () => {
    await apiRequest("POST", `/api/agents/${agentId}/sessions/${sessionId}/reopen`, {}, apiKey);

    const { createTask, assignTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Agent Claim Task", board_id: boardId });
    await assignTask(env.DB, task.id, agentId, "machine", "system");
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/claim`, {}, jwt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("in_progress");
  });

  it("POST /api/tasks/:id/review works with agent JWT", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
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
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Assign Stale Task", board_id: boardId });
    const leaderJwt = await signLeaderSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/assign`, { agent_id: agentId }, leaderJwt);
    expect(res.status).toBe(200);
  });
});
