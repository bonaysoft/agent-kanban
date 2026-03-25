// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration tests for Agent Entity Redesign:
// - Agent CRUD (update, delete)
// - Session lifecycle (close, multi-session)
// - Agent status computation (online/offline from sessions)
// - Message sender model (sender_type + sender_id)
// - User assigns task to agent
// - Delegation proof tamper detection

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
  const files = ["0001_initial.sql", "0002_rename_task_logs_to_task_notes.sql"];
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

async function seedUser(db: D1Database, id: string, email: string): Promise<string> {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(id, "Test User", email, now, now)
    .run();
  return id;
}

async function createApiKeyForUser(userId: string): Promise<string> {
  const { createAuth } = await import("../apps/web/functions/api/betterAuth");
  const auth = createAuth(env);
  const result = await auth.api.createApiKey({ body: { userId } });
  return result.key;
}

async function _apiRequest(method: string, path: string, body?: any, token?: string) {
  const { api } = await import("../apps/web/functions/api/routes");
  const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return api.request(path, init, env);
}

async function createSessionKeypair() {
  const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);
  return { publicKey: pubJwk.x!, privateKey: (keypair as any).privateKey };
}

async function _signJWT(sessionId: string, agentId: string, privateKey: CryptoKey): Promise<string> {
  return new SignJWT({ sub: sessionId, aid: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  env.DB = await mf.getD1Database("DB");
  await applyMigrations(env.DB);
});

afterAll(async () => {
  await mf.dispose();
});

describe("agent CRUD", () => {
  let userId: string;
  let agentId: string;

  it("setup user", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    userId = await seedUser(env.DB, "user-crud", "crud@test.com");
    const agent = await createAgent(env.DB, userId, { name: "CrudAgent", bio: "test bio", soul: "be helpful", runtime: "claude", model: "opus" });
    agentId = agent.id;
    expect(agent.name).toBe("CrudAgent");
    expect(agent.bio).toBe("test bio");
  });

  it("updates agent fields", async () => {
    const { updateAgent, getAgent } = await import("../apps/web/functions/api/agentRepo");
    await updateAgent(env.DB, agentId, { name: "UpdatedAgent", bio: "new bio", soul: "be precise" });
    const agent = await getAgent(env.DB, agentId, userId);
    expect(agent!.name).toBe("UpdatedAgent");
    expect(agent!.bio).toBe("new bio");
    expect(agent!.soul).toBe("be precise");
  });

  it("deletes agent", async () => {
    const { createAgent, deleteAgent } = await import("../apps/web/functions/api/agentRepo");
    const temp = await createAgent(env.DB, userId, { name: "ToDelete" });
    const deleted = await deleteAgent(env.DB, temp.id);
    expect(deleted).toBe(true);
    const row = await env.DB.prepare("SELECT id FROM agents WHERE id = ?").bind(temp.id).first();
    expect(row).toBeNull();
  });

  it("list agents returns computed status and usage", async () => {
    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const agent = agents.find((a) => a.id === agentId);
    expect(agent).toBeTruthy();
    expect(agent!.status).toBe("offline"); // no active sessions
    expect(agent!.input_tokens).toBe(0);
  });
});

describe("agent status computation", () => {
  let userId: string;
  let agentId: string;
  let machineId: string;
  let _apiKey: string;

  it("setup", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const { createMachine } = await import("../apps/web/functions/api/machineRepo");
    userId = await seedUser(env.DB, "user-status", "status@test.com");
    _apiKey = await createApiKeyForUser(userId);
    const machine = await createMachine(env.DB, userId, { name: "status-machine", os: "test", version: "1.0", runtimes: [] });
    machineId = machine.id;

    // Create BA agentHost
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const auth = createAuth(env);
    const authCtx = await auth.$context;
    await (authCtx.adapter.create as any)({
      model: "agentHost",
      data: {
        id: machineId,
        name: "status-machine",
        userId,
        status: "active",
        activatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      forceAllowId: true,
    });

    const agent = await createAgent(env.DB, userId, { name: "StatusAgent" });
    agentId = agent.id;
  });

  it("agent is offline with no sessions", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(env.DB, agentId, userId);
    expect(agent!.status).toBe("offline");
  });

  it("agent goes online when session is created", async () => {
    const { createSession } = await import("../apps/web/functions/api/agentSessionRepo");
    const { publicKey } = await createSessionKeypair();
    await createSession(env.DB, env, agentId, machineId, randomUUID(), publicKey, userId);

    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(env.DB, agentId, userId);
    expect(agent!.status).toBe("online");
  });

  it("agent stays online with multiple sessions", async () => {
    const { createSession } = await import("../apps/web/functions/api/agentSessionRepo");
    const { publicKey } = await createSessionKeypair();
    const sessionId2 = randomUUID();
    await createSession(env.DB, env, agentId, machineId, sessionId2, publicKey, userId);

    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const agent = agents.find((a) => a.id === agentId);
    expect(agent!.status).toBe("online");
  });

  it("agent goes offline when all sessions are closed", async () => {
    const { closeSession } = await import("../apps/web/functions/api/agentSessionRepo");
    const sessions = await env.DB.prepare("SELECT id FROM agent_sessions WHERE agent_id = ? AND status = 'active'").bind(agentId).all();
    for (const s of sessions.results as any[]) {
      await closeSession(env.DB, s.id);
    }

    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(env.DB, agentId, userId);
    expect(agent!.status).toBe("offline");
  });
});

describe("session lifecycle", () => {
  let userId: string;
  let agentId: string;
  let machineId: string;
  let sessionId: string;

  it("setup", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const { createMachine } = await import("../apps/web/functions/api/machineRepo");
    userId = await seedUser(env.DB, "user-session", "session@test.com");
    const machine = await createMachine(env.DB, userId, { name: "session-machine", os: "test", version: "1.0", runtimes: [] });
    machineId = machine.id;

    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const authCtx = await createAuth(env).$context;
    await (authCtx.adapter.create as any)({
      model: "agentHost",
      data: {
        id: machineId,
        name: "session-machine",
        userId,
        status: "active",
        activatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      forceAllowId: true,
    });

    const agent = await createAgent(env.DB, userId, { name: "SessionAgent" });
    agentId = agent.id;
  });

  it("close session sets status and closed_at", async () => {
    const { createSession, closeSession, getSession } = await import("../apps/web/functions/api/agentSessionRepo");
    const { publicKey } = await createSessionKeypair();
    sessionId = randomUUID();
    await createSession(env.DB, env, agentId, machineId, sessionId, publicKey, userId);

    await closeSession(env.DB, sessionId);
    const session = await getSession(env.DB, sessionId);
    expect(session!.status).toBe("closed");
    expect(session!.closed_at).toBeTruthy();
  });

  it("list sessions shows full history", async () => {
    const { createSession, listSessions } = await import("../apps/web/functions/api/agentSessionRepo");
    const { publicKey } = await createSessionKeypair();
    await createSession(env.DB, env, agentId, machineId, randomUUID(), publicKey, userId);

    const sessions = await listSessions(env.DB, agentId);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.some((s) => s.status === "closed")).toBe(true);
    expect(sessions.some((s) => s.status === "active")).toBe(true);
    expect(sessions[0].machine_name).toBe("session-machine");
  });

  it("session usage accumulates", async () => {
    const { updateSessionUsage } = await import("../apps/web/functions/api/agentSessionRepo");
    const active = await env.DB.prepare("SELECT id FROM agent_sessions WHERE agent_id = ? AND status = 'active'")
      .bind(agentId)
      .first<{ id: string }>();

    await updateSessionUsage(env.DB, active!.id, {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 10,
      cache_creation_tokens: 5,
      cost_micro_usd: 500,
    });
    await updateSessionUsage(env.DB, active!.id, {
      input_tokens: 200,
      output_tokens: 100,
      cache_read_tokens: 20,
      cache_creation_tokens: 10,
      cost_micro_usd: 1000,
    });

    const session = await env.DB.prepare("SELECT * FROM agent_sessions WHERE id = ?").bind(active!.id).first<any>();
    expect(session.input_tokens).toBe(300);
    expect(session.output_tokens).toBe(150);
    expect(session.cost_micro_usd).toBe(1500);
  });

  it("agent usage is aggregated from sessions", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(env.DB, agentId, userId);
    expect(agent!.input_tokens).toBeGreaterThanOrEqual(300);
    expect(agent!.cost_micro_usd).toBeGreaterThanOrEqual(1500);
  });
});

describe("message sender model", () => {
  let userId: string;
  let agentId: string;
  let taskId: string;

  it("setup board + task", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    userId = await seedUser(env.DB, "user-msg", "msg@test.com");
    const agent = await createAgent(env.DB, userId, { name: "MsgAgent" });
    agentId = agent.id;
    const board = await createBoard(env.DB, userId, "msg-board");
    const task = await createTask(env.DB, userId, { title: "Msg task", board_id: board.id });
    taskId = task.id;
  });

  it("creates user message with sender_type=user", async () => {
    const { createMessage } = await import("../apps/web/functions/api/messageRepo");
    const msg = await createMessage(env.DB, taskId, "user", userId, "Hello agent");
    expect(msg.sender_type).toBe("user");
    expect(msg.sender_id).toBe(userId);
    expect(msg.content).toBe("Hello agent");
  });

  it("creates agent message with sender_type=agent", async () => {
    const { createMessage } = await import("../apps/web/functions/api/messageRepo");
    const msg = await createMessage(env.DB, taskId, "agent", agentId, "Working on it");
    expect(msg.sender_type).toBe("agent");
    expect(msg.sender_id).toBe(agentId);
  });

  it("list messages returns sender fields", async () => {
    const { listMessages } = await import("../apps/web/functions/api/messageRepo");
    const msgs = await listMessages(env.DB, taskId);
    expect(msgs.length).toBe(2);
    expect(msgs[0].sender_type).toBe("user");
    expect(msgs[1].sender_type).toBe("agent");
    // old fields should not exist
    expect((msgs[0] as any).role).toBeUndefined();
    expect((msgs[0] as any).agent_id).toBeUndefined();
  });
});

describe("delegation proof security", () => {
  it("tampered proof is rejected", async () => {
    const { generateKeypair, computeFingerprint, signDelegation, verifyDelegation } = await import("@agent-kanban/shared");

    const agent = await generateKeypair();
    const session = await generateKeypair();
    const proof = await signDelegation(agent.privateKeyJwk, session.publicKeyBase64);

    // Tamper with the proof
    const tampered = `${proof.slice(0, -2)}XX`;
    const valid = await verifyDelegation(agent.publicKeyBase64, session.publicKeyBase64, tampered);
    expect(valid).toBe(false);
  });

  it("wrong agent key rejects proof", async () => {
    const { generateKeypair, signDelegation, verifyDelegation } = await import("@agent-kanban/shared");

    const agent1 = await generateKeypair();
    const agent2 = await generateKeypair();
    const session = await generateKeypair();
    const proof = await signDelegation(agent1.privateKeyJwk, session.publicKeyBase64);

    // Verify with wrong agent public key
    const valid = await verifyDelegation(agent2.publicKeyBase64, session.publicKeyBase64, proof);
    expect(valid).toBe(false);
  });

  it("wrong session key rejects proof", async () => {
    const { generateKeypair, signDelegation, verifyDelegation } = await import("@agent-kanban/shared");

    const agent = await generateKeypair();
    const session1 = await generateKeypair();
    const session2 = await generateKeypair();
    const proof = await signDelegation(agent.privateKeyJwk, session1.publicKeyBase64);

    // Verify with wrong session public key
    const valid = await verifyDelegation(agent.publicKeyBase64, session2.publicKeyBase64, proof);
    expect(valid).toBe(false);
  });
});

describe("user assigns task to agent", () => {
  let userId: string;
  let agentId: string;
  let taskId: string;

  it("setup", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    userId = await seedUser(env.DB, "user-assign", "assign@test.com");
    const agent = await createAgent(env.DB, userId, { name: "AssignAgent" });
    agentId = agent.id;
    const board = await createBoard(env.DB, userId, "assign-board");
    const task = await createTask(env.DB, userId, { title: "Assign task", board_id: board.id });
    taskId = task.id;
  });

  it("assigns task via repo function", async () => {
    const { assignTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await assignTask(env.DB, taskId, agentId);
    expect(task!.assigned_to).toBe(agentId);
    expect(task!.status).toBe("todo"); // assign doesn't change status
  });

  it("task logs record assignment with persistent agent ID", async () => {
    const logs = await env.DB.prepare("SELECT * FROM task_notes WHERE task_id = ? AND action = 'assigned'").bind(taskId).all();
    expect(logs.results.length).toBe(1);
    expect((logs.results[0] as any).agent_id).toBe(agentId);
  });

  it("release resets status from in_progress to todo", async () => {
    const { claimTask, releaseTask } = await import("../apps/web/functions/api/taskRepo");
    await claimTask(env.DB, taskId, agentId, "agent");
    const task = await releaseTask(env.DB, taskId, agentId, "machine");
    expect(task!.status).toBe("todo");
  });
});
