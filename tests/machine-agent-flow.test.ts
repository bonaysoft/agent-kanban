// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test: full flow — user creates agent → machine creates session → agent claims task
// Tests the actual Hono routes with auth middleware.

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";
const BETTER_AUTH_URL = "http://localhost:8788";

const env = {
  DB: null as any as D1Database,
  AUTH_SECRET,
  ALLOWED_HOSTS: "localhost:8788",
  GITHUB_CLIENT_ID: "x",
  GITHUB_CLIENT_SECRET: "x",
};

let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = ["0001_initial.sql"];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.prepare(stmt).run();
    }
  }
}

async function seedUser(db: D1Database): Promise<string> {
  const userId = "test-user-flow";
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(userId, "Flow Test User", "flow@example.com", now, now)
    .run();
  return userId;
}

async function createApiKeyForUser(db: D1Database, userId: string): Promise<string> {
  const { createAuth } = await import("../apps/web/functions/api/betterAuth");
  const auth = createAuth({ ...env, DB: db });
  const result = await auth.api.createApiKey({ body: { userId } });
  return result.key;
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  const db = await mf.getD1Database("DB");
  env.DB = db;
  await applyMigrations(db);
});

afterAll(async () => {
  await mf.dispose();
});

describe("machine → agent session flow", () => {
  let userId: string;
  let apiKey: string;
  let machineId: string;
  let agentId: string;
  let sessionId: string;
  let sessionPrivateKey: CryptoKey;
  let boardId: string;
  let taskId: string;

  async function apiRequest(method: string, path: string, body?: any, token?: string) {
    const { api } = await import("../apps/web/functions/api/routes");
    const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);
    return api.request(path, init, env);
  }

  async function signSessionJWT(): Promise<string> {
    return new SignJWT({ sub: sessionId, aid: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(sessionPrivateKey);
  }

  it("creates user and API key", async () => {
    userId = await seedUser(env.DB);
    apiKey = await createApiKeyForUser(env.DB, userId);
    expect(apiKey.startsWith("ak_")).toBe(true);
  });

  it("creates a machine via API", async () => {
    const res = await apiRequest(
      "POST",
      "/api/machines",
      {
        name: "test-machine-01",
        os: "darwin arm64",
        version: "1.0.0",
        runtimes: ["Claude Code"],
      },
      apiKey,
    );
    expect(res.status).toBe(201);
    const machine = (await res.json()) as any;
    machineId = machine.id;
  });

  it("machine heartbeat updates status to online", async () => {
    const res = await apiRequest("POST", `/api/machines/${machineId}/heartbeat`, {}, apiKey);
    expect(res.status).toBe(200);
  });

  it("user creates a persistent agent", async () => {
    // Create agent directly via repo (user-only route, no API key auth in test)
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await createAgent(env.DB, userId, { name: "Test Agent", runtime: "Claude Code", model: "claude-sonnet-4-20250514" });
    agentId = agent.id;
    expect(agent.fingerprint).toBeTruthy();
    expect(agent.public_key).toBeTruthy();
  });

  it("machine creates a session for the agent (CSR)", async () => {
    sessionId = randomUUID();
    const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    sessionPrivateKey = (keypair as any).privateKey;
    const pubJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);

    const res = await apiRequest(
      "POST",
      `/api/agents/${agentId}/sessions`,
      {
        session_id: sessionId,
        session_public_key: pubJwk.x!,
      },
      apiKey,
    );
    expect(res.status).toBe(201);
    const result = (await res.json()) as any;
    expect(result.delegation_proof).toBeTruthy();

    // Verify BA agent was created for this session
    const baAgent = await env.DB.prepare("SELECT * FROM agent WHERE id = ?").bind(sessionId).first();
    expect(baAgent).toBeTruthy();
  });

  it("session JWT authenticates through HTTP handler", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("GET", "/api/agents", undefined, jwt);
    expect(res.status).toBe(200);
  });

  it("creates a board and task", async () => {
    const board = await (await import("../apps/web/functions/api/boardRepo")).createBoard(env.DB, userId, "test-board");
    boardId = board.id;
    const task = await (await import("../apps/web/functions/api/taskRepo")).createTask(env.DB, userId, {
      title: "Test task for agent",
      board_id: boardId,
    });
    taskId = task.id;
  });

  it("machine assigns task to persistent agent", async () => {
    const res = await apiRequest("POST", `/api/tasks/${taskId}/assign`, { agent_id: agentId }, apiKey);
    expect(res.status).toBe(200);
    const task = (await res.json()) as any;
    expect(task.assigned_to).toBe(agentId);
  });

  it("agent claims the assigned task via session JWT", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${taskId}/claim`, { agent_id: agentId }, jwt);
    expect(res.status).toBe(200);
    const task = (await res.json()) as any;
    expect(task.status).toBe("in_progress");
  });

  it("agent adds a task log", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${taskId}/logs`, { detail: "Working on it" }, jwt);
    expect(res.status).toBe(201);
  });

  it("agent submits task for review", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${taskId}/review`, { pr_url: "https://github.com/test/repo/pull/1" }, jwt);
    expect(res.status).toBe(200);
    const task = (await res.json()) as any;
    expect(task.status).toBe("in_review");
  });

  it("agent reports session usage", async () => {
    const jwt = await signSessionJWT();
    const res = await apiRequest(
      "PATCH",
      `/api/agents/${agentId}/sessions/${sessionId}/usage`,
      {
        input_tokens: 1500,
        output_tokens: 800,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        cost_micro_usd: 0,
      },
      jwt,
    );
    expect(res.status).toBe(200);

    const session = await env.DB.prepare("SELECT input_tokens, output_tokens FROM agent_sessions WHERE id = ?").bind(sessionId).first();
    expect(session!.input_tokens).toBe(1500);
    expect(session!.output_tokens).toBe(800);
  });

  it("GET /api/machines/:id returns agents with correct fields", async () => {
    const res = await apiRequest("GET", `/api/machines/${machineId}`, undefined, apiKey);
    expect(res.status).toBe(200);
    const machine = (await res.json()) as any;
    expect(machine.agents).toHaveLength(1);
    const agent = machine.agents[0];
    expect(agent.id).toBe(agentId);
    expect(agent.name).toBe("Test Agent");
    expect(agent.status).toBe("working");
    expect(agent.last_active_at).toBeTruthy();
  });

  it("final state is consistent", async () => {
    const machine = await env.DB.prepare("SELECT status FROM machines WHERE id = ?").bind(machineId).first();
    expect(machine!.status).toBe("online");

    const agent = (await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first()) as any;
    expect(agent.owner_id).toBe(userId);

    const session = (await env.DB.prepare("SELECT * FROM agent_sessions WHERE id = ?").bind(sessionId).first()) as any;
    expect(session.agent_id).toBe(agentId);
    expect(session.machine_id).toBe(machineId);

    const task = (await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first()) as any;
    expect(task.status).toBe("in_review");
    expect(task.assigned_to).toBe(agentId);

    const logs = await env.DB.prepare("SELECT action FROM task_logs WHERE task_id = ? ORDER BY created_at").bind(taskId).all();
    const actions = logs.results.map((r: any) => r.action);
    expect(actions).toContain("created");
    expect(actions).toContain("assigned");
    expect(actions).toContain("claimed");
    expect(actions).toContain("commented");
    expect(actions).toContain("review_requested");
  });
});
