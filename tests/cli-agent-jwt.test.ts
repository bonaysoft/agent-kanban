// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Miniflare } from "miniflare";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

// Integration test: validates the full agent JWT passthrough from daemon env vars → CLI ApiClient → server auth.
// 1. ApiClient generates correct agent JWT when AK_AGENT_* env vars are set
// 2. That JWT is accepted by the server's auth middleware for claim/review

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
  const files = ["0001_initial.sql"];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
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
  if (token) headers["Authorization"] = `Bearer ${token}`;
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
  let machineId: string;
  let agentId: string;
  let boardId: string;
  let taskId: string;
  let privKeyJwk: JsonWebKey;

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

  it("sets up machine + agent + board + task", async () => {
    userId = await seedUser(testEnv.DB);
    apiKey = await createApiKeyForUser(testEnv.DB, userId);

    // Create machine
    const machineRes = await honoRequest("POST", "/api/machines", {
      name: "jwt-test-machine", os: "test", version: "1.0.0", runtimes: ["claude"],
    }, apiKey);
    expect(machineRes.status).toBe(201);
    machineId = ((await machineRes.json()) as any).id;

    // Generate agent keypair (same as daemon does)
    const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);
    privKeyJwk = await crypto.subtle.exportKey("jwk", (keypair as any).privateKey);

    agentId = randomUUID();

    // Register agent
    const agentRes = await honoRequest("POST", "/api/agents", {
      agent_id: agentId, public_key: pubKeyJwk.x, runtime: "claude",
    }, apiKey);
    expect(agentRes.status).toBe(201);

    // Create board and task
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const board = await createBoard(testEnv.DB, userId, "jwt-test-board");
    boardId = board.id;
    const task = await createTask(testEnv.DB, userId, { title: "JWT test task", board_id: boardId });
    taskId = task.id;

    // Assign task to agent
    const assignRes = await honoRequest("POST", `/api/tasks/${taskId}/assign`, { agent_id: agentId }, apiKey);
    expect(assignRes.status).toBe(200);
  });

  it("ApiClient constructs valid agent JWT that server accepts for claim", async () => {
    // Set env vars exactly as daemon would
    setEnv({
      AK_AGENT_ID: agentId,
      AK_AGENT_KEY: JSON.stringify(privKeyJwk),
      AK_API_URL: BETTER_AUTH_URL,
    });

    // Intercept fetch to capture the Authorization header, then forward to Hono
    let capturedToken: string | null = null;
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      capturedToken = headers.get("Authorization")?.replace("Bearer ", "") || null;

      // Forward to Hono app
      return honoRequest(init?.method || "GET", path, init?.body ? JSON.parse(init.body as string) : undefined, capturedToken!);
    });

    // Dynamically import — createClient() detects env vars and returns AgentClient
    const { createClient } = await import("../packages/cli/src/client.js");
    const client = await createClient();

    const claimed = await client.claimTask(taskId) as any;
    expect(claimed.status).toBe("in_progress");
    expect(claimed.assigned_to).toBe(agentId);

    // Verify the token was a JWT, not an API key
    expect(capturedToken).toBeTruthy();
    expect(capturedToken!.startsWith("ak_")).toBe(false);
    expect(capturedToken!.split(".")).toHaveLength(3);
  });

  it("ApiClient constructs valid agent JWT that server accepts for review", async () => {
    setEnv({
      AK_AGENT_ID: agentId,
      AK_AGENT_KEY: JSON.stringify(privKeyJwk),
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

    const reviewed = await client.reviewTask(taskId, { pr_url: "https://github.com/test/pull/1" }) as any;
    expect(reviewed.status).toBe("in_review");
    expect(capturedToken!.startsWith("ak_")).toBe(false);
  });

  it("machine API key is correctly rejected for claim (agent-only endpoint)", async () => {
    const res = await honoRequest("POST", `/api/tasks/${taskId}/claim`, { agent_id: agentId }, apiKey);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error.message).toContain("agent required");
  });
});
