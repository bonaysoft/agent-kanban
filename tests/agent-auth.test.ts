// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test: validates the new agent-auth bridge
// User creates Agent → Machine creates Session (CSR) → Session JWT → auth

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";
const BETTER_AUTH_URL = "http://localhost:8788";

let db: D1Database;
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
    "0012_gpg_keys.sql",
    "0013_agent_identity.sql",
    "0014_agent_mailbox_token.sql",
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }
  }
}

async function seedUser(db: D1Database): Promise<string> {
  const userId = "test-user-001";
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(userId, "Test User", "test@example.com", now, now)
    .run();
  return userId;
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  db = await mf.getD1Database("DB");
  await applyMigrations(db);
});

afterAll(async () => {
  await mf.dispose();
});

describe("agent-auth bridge", () => {
  let userId: string;
  let machineId: string;
  let agentId: string;

  it("seeds a test user", async () => {
    userId = await seedUser(db);
    const row = await db.prepare("SELECT id FROM user WHERE id = ?").bind(userId).first();
    expect(row).toBeTruthy();
  });

  it("creates a machine with BA agentHost", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const { upsertMachine } = await import("../apps/web/functions/api/machineRepo");

    const env = { DB: db, AUTH_SECRET, ALLOWED_HOSTS: "localhost:8788", GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "x" };
    const auth = createAuth(env);
    const machine = await upsertMachine(db, userId, {
      name: "test-machine",
      os: "darwin arm64",
      version: "1.0.0",
      runtimes: ["Claude Code"],
      device_id: "test-device-auth",
    });
    machineId = machine.id;

    const authCtx = await auth.$context;
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agentHost",
      data: { id: machine.id, name: machine.name, userId, status: "active", activatedAt: now, createdAt: now, updatedAt: now },
      forceAllowId: true,
    });

    const baHost = await db.prepare("SELECT * FROM agentHost WHERE id = ?").bind(machineId).first();
    expect(baHost).toBeTruthy();
  });

  it("creates a persistent agent with keypair", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await createAgent(db, userId, { name: "Test Agent", runtime: "claude" });
    agentId = agent.id;

    expect(agent.public_key).toBeTruthy();
    expect(agent.fingerprint).toBeTruthy();
    expect(agent.id).toBe(agent.fingerprint.slice(-16));

    const row = await db.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first();
    expect(row).toBeTruthy();
    expect(row!.private_key).toBeTruthy();
  });

  it("creates a session with delegation proof via CSR", async () => {
    const { createSession } = await import("../apps/web/functions/api/agentSessionRepo");
    const env = { DB: db, AUTH_SECRET, ALLOWED_HOSTS: "localhost:8788", GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "x" };

    const sessionId = randomUUID();
    const { publicKey } = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);

    const result = await createSession(db, env, agentId, machineId, sessionId, pubJwk.x!, userId);
    expect(result.delegation_proof).toBeTruthy();

    const session = await db.prepare("SELECT * FROM agent_sessions WHERE id = ?").bind(sessionId).first();
    expect(session).toBeTruthy();
    expect(session!.agent_id).toBe(agentId);
    expect(session!.delegation_proof).toBe(result.delegation_proof);

    const baAgent = await db.prepare("SELECT * FROM agent WHERE id = ?").bind(sessionId).first();
    expect(baAgent).toBeTruthy();
    expect(baAgent!.hostId).toBe(machineId);
  });

  it("session JWT authenticates through HTTP handler", async () => {
    const { createSession } = await import("../apps/web/functions/api/agentSessionRepo");
    const { api } = await import("../apps/web/functions/api/routes");
    const env = { DB: db, AUTH_SECRET, ALLOWED_HOSTS: "localhost:8788", GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "x" };

    const sessionId = randomUUID();
    const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);

    await createSession(db, env, agentId, machineId, sessionId, pubJwk.x!, userId);

    const jwt = await new SignJWT({ sub: sessionId, aid: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(privateKey);

    const res = await api.request(
      "/api/agents",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}`, Host: "localhost:8788", "x-forwarded-proto": "http" },
      },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("delegation proof is verifiable with agent public key", async () => {
    const { verifyDelegation } = await import("@agent-kanban/shared");

    const agent = await db.prepare("SELECT public_key FROM agents WHERE id = ?").bind(agentId).first<{ public_key: string }>();
    const sessions = await db.prepare("SELECT * FROM agent_sessions WHERE agent_id = ?").bind(agentId).all();

    for (const session of sessions.results as any[]) {
      const valid = await verifyDelegation(agent!.public_key, session.public_key, session.delegation_proof);
      expect(valid).toBe(true);
    }
  });
});
