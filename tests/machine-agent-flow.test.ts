// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { SignJWT } from "jose";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

// Integration test: full flow from machine creation → agent online → task claim
// Tests the actual Hono routes with auth middleware, not just repo functions.

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
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
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

describe("machine → agent online flow", () => {
  let userId: string;
  let apiKey: string;
  let machineId: string;
  let agentId: string;
  let agentPrivateKey: CryptoKey;
  let agentPubKeyBase64: string;
  let boardId: string;
  let taskId: string;

  async function apiRequest(method: string, path: string, body?: any, token?: string) {
    const { api } = await import("../apps/web/functions/api/routes");
    const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);
    return api.request(path, init, env);
  }

  async function signAgentJWT(): Promise<string> {
    return new SignJWT({ sub: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(agentPrivateKey);
  }

  // Step 1: Seed user and create API key
  it("creates user and API key", async () => {
    userId = await seedUser(env.DB);
    apiKey = await createApiKeyForUser(env.DB, userId);
    expect(apiKey).toBeTruthy();
    expect(apiKey.startsWith("ak_")).toBe(true);
  });

  // Step 1.5: Creating machine without required fields returns 400
  it("rejects machine creation missing required fields", async () => {
    const res1 = await apiRequest("POST", "/api/machines", { name: "incomplete" }, apiKey);
    expect(res1.status).toBe(400);

    const res2 = await apiRequest("POST", "/api/machines", { name: "x", os: "linux", version: "1.0" }, apiKey);
    expect(res2.status).toBe(400);
  });

  // Step 2: Machine creates itself via POST /api/machines
  it("creates a machine via API", async () => {
    const res = await apiRequest("POST", "/api/machines", {
      name: "test-machine-01", os: "darwin arm64", version: "1.0.0", runtimes: ["Claude Code"],
    }, apiKey);
    expect(res.status).toBe(201);
    const machine = await res.json() as any;
    machineId = machine.id;
    expect(machine.name).toBe("test-machine-01");
    expect(machine.os).toBe("darwin arm64");
    expect(machine.runtimes).toEqual(["Claude Code"]);
    expect(machine.status).toBe("offline");

    // Verify agentHost was created in BA
    const baHost = await env.DB.prepare("SELECT * FROM agentHost WHERE id = ?").bind(machineId).first();
    expect(baHost).toBeTruthy();
    expect(baHost!.userId).toBe(userId);
  });

  // Step 3: Machine sends heartbeat → status becomes online
  it("machine heartbeat updates status to online", async () => {
    const res = await apiRequest(
      "POST",
      `/api/machines/${machineId}/heartbeat`,
      {},
      apiKey,
    );
    expect(res.status).toBe(200);
    const machine = await res.json() as any;
    expect(machine.status).toBe("online");
    expect(machine.os).toBe("darwin arm64");
  });

  // Step 4: Machine registers an agent via POST /api/agents
  it("registers an agent via API", async () => {
    agentId = randomUUID();
    const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    agentPrivateKey = (keypair as any).privateKey;
    const pubJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);
    agentPubKeyBase64 = pubJwk.x!;

    const res = await apiRequest(
      "POST",
      "/api/agents",
      { agent_id: agentId, public_key: agentPubKeyBase64, runtime: "Claude Code", model: "claude-sonnet-4-20250514" },
      apiKey,
    );
    expect(res.status).toBe(201);
    const agent = await res.json() as any;
    expect(agent.id).toBe(agentId);
    expect(agent.machine_id).toBe(machineId);
    expect(agent.status).toBe("idle");

    // Verify BA agent and capabilities
    const baAgent = await env.DB.prepare("SELECT * FROM agent WHERE id = ?").bind(agentId).first();
    expect(baAgent).toBeTruthy();
    expect(baAgent!.hostId).toBe(machineId);

    const caps = await env.DB.prepare("SELECT capability FROM agentCapabilityGrant WHERE agentId = ?").bind(agentId).all();
    const capNames = caps.results.map((r: any) => r.capability).sort();
    expect(capNames).toEqual(["agent:usage", "task:claim", "task:log", "task:message", "task:review"]);
  });

  // Step 5: Agent JWT is valid — verify through HTTP handler (not auth.api.*)
  it("agent JWT authenticates through HTTP handler", async () => {
    const jwt = await signAgentJWT();
    const res = await apiRequest("GET", "/api/agents", undefined, jwt);
    expect(res.status).toBe(200);
  });

  // Step 6: Create a board and task (as user) for agent to claim
  it("creates a board and task for the agent", async () => {
    // Create user session for board/task creation — seed directly
    const board = await (await import("../apps/web/functions/api/boardRepo")).createBoard(env.DB, userId, "test-board");
    boardId = board.id;

    const task = await (await import("../apps/web/functions/api/taskRepo")).createTask(env.DB, userId, {
      title: "Test task for agent",
      board_id: boardId,
    });
    taskId = task.id;
    expect(task.status).toBe("todo");
  });

  // Step 7: Machine assigns task to agent
  it("machine assigns task to agent", async () => {
    const res = await apiRequest(
      "POST",
      `/api/tasks/${taskId}/assign`,
      { agent_id: agentId },
      apiKey,
    );
    expect(res.status).toBe(200);
    const task = await res.json() as any;
    expect(task.assigned_to).toBe(agentId);
    expect(task.status).toBe("todo");
  });

  // Step 8: Agent claims the task with JWT
  it("agent claims the assigned task", async () => {
    const jwt = await signAgentJWT();
    const res = await apiRequest(
      "POST",
      `/api/tasks/${taskId}/claim`,
      { agent_id: agentId },
      jwt,
    );
    expect(res.status).toBe(200);
    const task = await res.json() as any;
    expect(task.status).toBe("in_progress");
    expect(task.assigned_to).toBe(agentId);

    // Agent status should be "working"
    const agent = await env.DB.prepare("SELECT status FROM agents WHERE id = ?").bind(agentId).first();
    expect(agent!.status).toBe("working");
  });

  // Step 9: Agent adds a log entry
  it("agent adds a task log", async () => {
    const jwt = await signAgentJWT();
    const res = await apiRequest(
      "POST",
      `/api/tasks/${taskId}/logs`,
      { detail: "Started working on the implementation" },
      jwt,
    );
    expect(res.status).toBe(201);
  });

  // Step 10: Agent submits for review
  it("agent submits task for review", async () => {
    const jwt = await signAgentJWT();
    const res = await apiRequest(
      "POST",
      `/api/tasks/${taskId}/review`,
      { pr_url: "https://github.com/test/repo/pull/1" },
      jwt,
    );
    expect(res.status).toBe(200);
    const task = await res.json() as any;
    expect(task.status).toBe("in_review");
  });

  // Step 11: Agent reports usage
  it("agent reports token usage", async () => {
    const jwt = await signAgentJWT();
    const res = await apiRequest(
      "PATCH",
      `/api/agents/${agentId}/usage`,
      { input_tokens: 1500, output_tokens: 800, cache_read_tokens: 0, cache_creation_tokens: 0, cost_micro_usd: 0 },
      jwt,
    );
    expect(res.status).toBe(200);

    const agent = await env.DB.prepare("SELECT input_tokens, output_tokens FROM agents WHERE id = ?").bind(agentId).first();
    expect(agent!.input_tokens).toBe(1500);
    expect(agent!.output_tokens).toBe(800);
  });

  // Step 12: Verify the complete flow state
  it("final state is consistent", async () => {
    // Machine is online
    const machine = await env.DB.prepare("SELECT status FROM machines WHERE id = ?").bind(machineId).first();
    expect(machine!.status).toBe("online");

    // Agent exists with correct linkage
    const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first() as any;
    expect(agent.machine_id).toBe(machineId);

    // Task is in review with correct agent
    const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first() as any;
    expect(task.status).toBe("in_review");
    expect(task.assigned_to).toBe(agentId);

    // Task logs show the full lifecycle
    const logs = await env.DB.prepare("SELECT action FROM task_logs WHERE task_id = ? ORDER BY created_at").bind(taskId).all();
    const actions = logs.results.map((r: any) => r.action);
    expect(actions).toContain("created");
    expect(actions).toContain("assigned");
    expect(actions).toContain("claimed");
    expect(actions).toContain("commented");
    expect(actions).toContain("review_requested");
  });
});
