// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Integration test: validates CLI AgentClient JWT passthrough with new session model
// User creates agent → machine creates session → AgentClient uses session JWT

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";
const BETTER_AUTH_URL = "http://localhost:8788";

const testEnv = {
  DB: null as any as D1Database,
  AUTH_SECRET,
  ALLOWED_HOSTS: "localhost:8788",
  GITHUB_CLIENT_ID: "x",
  GITHUB_CLIENT_SECRET: "x",
};

let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = [
    "0001_initial.sql",
    "0002_rename_task_logs_to_task_notes.sql",
    "0003_agent_kind.sql",
    "0004_rename_task_notes_to_task_actions.sql",
    "0005_agent_runtime_required.sql",
    "0006_add_device_id.sql",
    "0007_task_seq.sql",
    "0010_board_type.sql",
    "0011_task_scheduled_at.sql",
    "0012_agent_username.sql",
  ];
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
  const userId = "test-user-cli-jwt";
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(userId, "CLI JWT Test", "cli-jwt@example.com", now, now)
    .run();
  return userId;
}

async function createApiKeyForUser(db: D1Database, userId: string): Promise<string> {
  const { createAuth } = await import("../apps/web/functions/api/betterAuth");
  const auth = createAuth({ ...testEnv, DB: db });
  const result = await auth.api.createApiKey({ body: { userId } });
  return result.key;
}

async function honoRequest(method: string, path: string, body?: any, token?: string) {
  const { api } = await import("../apps/web/functions/api/routes");
  const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return api.request(path, init, testEnv);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  const db = await mf.getD1Database("DB");
  testEnv.DB = db;
  await applyMigrations(db);
});

afterAll(async () => {
  await mf.dispose();
});

describe("CLI ApiClient agent JWT passthrough", () => {
  let userId: string;
  let apiKey: string;
  let _machineId: string;
  let agentId: string;
  let sessionId: string;
  let boardId: string;
  let taskId: string;
  let sessionPrivKeyJwk: JsonWebKey;
  let leaderAgentId: string;
  let leaderSessionId: string;

  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(vars: Record<string, string>) {
    for (const [k, v] of Object.entries(vars)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it("sets up machine + agent + session + board + task", async () => {
    userId = await seedUser(testEnv.DB);
    apiKey = await createApiKeyForUser(testEnv.DB, userId);

    // Create machine
    const machineRes = await honoRequest(
      "POST",
      "/api/machines",
      {
        name: "jwt-test-machine",
        os: "test",
        version: "1.0.0",
        runtimes: ["claude"],
        device_id: "test-device-cli-jwt",
      },
      apiKey,
    );
    expect(machineRes.status).toBe(201);
    _machineId = ((await machineRes.json()) as any).id;

    // Create persistent agent (user-only, use repo directly)
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await createAgent(testEnv.DB, userId, { name: "JWT Test Agent", runtime: "claude" });
    agentId = agent.id;

    // Create session keypair (CSR — daemon generates locally)
    sessionId = randomUUID();
    const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);
    sessionPrivKeyJwk = await crypto.subtle.exportKey("jwk", (keypair as any).privateKey);

    // Register session via API
    const sessionRes = await honoRequest(
      "POST",
      `/api/agents/${agentId}/sessions`,
      {
        session_id: sessionId,
        session_public_key: pubJwk.x!,
      },
      apiKey,
    );
    expect(sessionRes.status).toBe(201);

    // Create leader agent + session for assign
    const leaderAgent = await createAgent(testEnv.DB, userId, { name: "JWT Leader Agent", runtime: "claude", kind: "leader" });
    leaderAgentId = leaderAgent.id;
    leaderSessionId = randomUUID();
    const leaderKeypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const leaderPubJwk = await crypto.subtle.exportKey("jwk", (leaderKeypair as any).publicKey);
    const leaderSessionRes = await honoRequest(
      "POST",
      `/api/agents/${leaderAgentId}/sessions`,
      { session_id: leaderSessionId, session_public_key: leaderPubJwk.x! },
      apiKey,
    );
    expect(leaderSessionRes.status).toBe(201);

    // Create board + task
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const { createTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
    const board = await createBoard(testEnv.DB, userId, "jwt-test-board", "ops");
    boardId = board.id;
    const task = await createTask(testEnv.DB, userId, { title: "JWT test task", board_id: boardId });
    taskId = task.id;

    // Assign task to the worker agent so the worker can claim it in subsequent tests
    await assignTask(testEnv.DB, taskId, agentId, "machine", "system");
  });

  it("ApiClient constructs valid session JWT that server accepts for claim", async () => {
    setEnv({
      AK_AGENT_ID: agentId,
      AK_SESSION_ID: sessionId,
      AK_AGENT_KEY: JSON.stringify(sessionPrivKeyJwk),
      AK_API_URL: BETTER_AUTH_URL,
    });

    let capturedToken: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      capturedToken = headers.get("Authorization")?.replace("Bearer ", "") || null;
      return honoRequest(init?.method || "GET", path, init?.body ? JSON.parse(init.body as string) : undefined, capturedToken!);
    });

    const { createClient } = await import("../packages/cli/src/client.js");
    const client = await createClient();

    const claimed = (await client.claimTask(taskId)) as any;
    expect(claimed.status).toBe("in_progress");
    expect(claimed.assigned_to).toBe(agentId);
    expect(capturedToken!.split(".")).toHaveLength(3);
  });

  it("ApiClient constructs valid session JWT that server accepts for review", async () => {
    setEnv({
      AK_AGENT_ID: agentId,
      AK_SESSION_ID: sessionId,
      AK_AGENT_KEY: JSON.stringify(sessionPrivKeyJwk),
      AK_API_URL: BETTER_AUTH_URL,
    });

    let capturedToken: string | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      capturedToken = headers.get("Authorization")?.replace("Bearer ", "") || null;
      return honoRequest(init?.method || "GET", path, init?.body ? JSON.parse(init.body as string) : undefined, capturedToken!);
    });

    const { createClient } = await import("../packages/cli/src/client.js");
    const client = await createClient();

    const reviewed = (await client.reviewTask(taskId, { pr_url: "https://github.com/test/pull/1" })) as any;
    expect(reviewed.status).toBe("in_review");
  });

  it("machine API key is correctly rejected for claim (agent-only endpoint)", async () => {
    const res = await honoRequest("POST", `/api/tasks/${taskId}/claim`, { agent_id: agentId }, apiKey);
    expect(res.status).toBe(403);
  });
});
