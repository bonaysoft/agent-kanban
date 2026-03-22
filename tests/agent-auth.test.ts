// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { SignJWT } from "jose";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

// Integration test: validates the full agent-auth bridge
// Machine register → Agent register (both tables) → Agent JWT → getAgentSession

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";
const BETTER_AUTH_URL = "http://localhost:8788";

let db: D1Database;
let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = ["0001_initial.sql"];
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
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)"
    )
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

  it("seeds a test user", async () => {
    userId = await seedUser(db);
    const row = await db.prepare("SELECT id FROM user WHERE id = ?").bind(userId).first();
    expect(row).toBeTruthy();
  });

  it("creates both custom machine and BA agentHost with same ID", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const { createMachine } = await import("../apps/web/functions/api/machineRepo");

    const env = { DB: db, AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" };
    const auth = createAuth(env);
    const machine = await createMachine(db, userId, { name: "test-machine", os: "darwin arm64", version: "1.0.0", runtimes: ["Claude Code"] });
    machineId = machine.id;

    const authCtx = await auth.$context;
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agentHost",
      data: {
        id: machine.id,
        name: machine.name,
        userId,
        status: "active",
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      forceAllowId: true,
    });

    // Verify custom machine
    const customMachine = await db.prepare("SELECT * FROM machines WHERE id = ?").bind(machineId).first();
    expect(customMachine).toBeTruthy();
    expect(customMachine!.owner_id).toBe(userId);

    // Verify BA agentHost with same ID
    const baHost = await db.prepare("SELECT * FROM agentHost WHERE id = ?").bind(machineId).first();
    expect(baHost).toBeTruthy();
    expect(baHost!.userId).toBe(userId);
    expect(baHost!.status).toBe("active");
  });

  it("creates both custom agent and BA agent with JWK public key", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");

    const agentId = randomUUID();
    const env = { DB: db, AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" };

    const { publicKey } = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any, true, ["sign", "verify"]
    );
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const pubKeyBase64 = pubKeyJwk.x!;

    const agent = await createAgent(db, machineId, agentId, pubKeyBase64);

    const auth = createAuth(env);
    const authCtx = await auth.$context;
    const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: pubKeyBase64 });
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agent",
      data: {
        id: agentId,
        name: agent.name,
        userId,
        hostId: machineId,
        status: "active",
        mode: "autonomous",
        publicKey: jwk,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      forceAllowId: true,
    });

    // Verify custom agent
    const customAgent = await db.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first();
    expect(customAgent).toBeTruthy();
    expect(customAgent!.machine_id).toBe(machineId);

    // Verify BA agent
    const baAgent = await db.prepare("SELECT * FROM agent WHERE id = ?").bind(agentId).first();
    expect(baAgent).toBeTruthy();
    expect(baAgent!.hostId).toBe(machineId);
    expect(baAgent!.status).toBe("active");
    expect(baAgent!.publicKey).toBe(jwk);
  });

  it("getAgentSession verifies agent JWT and returns session", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const env = { DB: db, AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" };
    const auth = createAuth(env);

    const agentId = randomUUID();
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any, true, ["sign", "verify"]
    );
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: pubKeyJwk.x });

    const authCtx = await auth.$context;
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agent",
      data: {
        id: agentId,
        name: `Agent-${agentId.slice(0, 6)}`,
        userId,
        hostId: machineId,
        status: "active",
        mode: "autonomous",
        publicKey: jwk,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      forceAllowId: true,
    });

    const jwt = await new SignJWT({ sub: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(privateKey);

    const headers = new Headers({ Authorization: `Bearer ${jwt}` });
    const session = await auth.api.getAgentSession({ headers });

    expect(session).toBeTruthy();
    expect(session!.agent.id).toBe(agentId);
    expect(session!.agent.hostId).toBe(machineId);
    expect(session!.agent.mode).toBe("autonomous");
  });

  it("getAgentSession rejects JWT without jti", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const env = { DB: db, AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" };
    const auth = createAuth(env);

    const agentId = randomUUID();
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any, true, ["sign", "verify"]
    );
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: pubKeyJwk.x });

    const authCtx = await auth.$context;
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agent",
      data: {
        id: agentId,
        name: `Agent-${agentId.slice(0, 6)}`,
        userId,
        hostId: machineId,
        status: "active",
        mode: "autonomous",
        publicKey: jwk,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      forceAllowId: true,
    });

    // Sign JWT WITHOUT jti
    const jwt = await new SignJWT({ sub: agentId, aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(privateKey);

    const headers = new Headers({ Authorization: `Bearer ${jwt}` });
    await expect(auth.api.getAgentSession({ headers })).rejects.toThrow();
  });

  it("getAgentSession rejects JWT signed with wrong key", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const env = { DB: db, AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" };
    const auth = createAuth(env);

    const agentId = randomUUID();
    const { publicKey: registeredPub } = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any, true, ["sign", "verify"]
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", registeredPub);
    const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: pubJwk.x });

    const authCtx = await auth.$context;
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agent",
      data: {
        id: agentId,
        name: `Agent-${agentId.slice(0, 6)}`,
        userId,
        hostId: machineId,
        status: "active",
        mode: "autonomous",
        publicKey: jwk,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      forceAllowId: true,
    });

    // Sign with a DIFFERENT private key
    const { privateKey: wrongKey } = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any, true, ["sign", "verify"]
    );
    const jwt = await new SignJWT({ sub: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(wrongKey);

    const headers = new Headers({ Authorization: `Bearer ${jwt}` });
    await expect(auth.api.getAgentSession({ headers })).rejects.toThrow();
  });

  it("getAgentSession returns capabilities in session", async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const env = { DB: db, AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" };
    const auth = createAuth(env);

    const agentId = randomUUID();
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any, true, ["sign", "verify"]
    );
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: pubKeyJwk.x });

    const authCtx = await auth.$context;
    const now = new Date();
    await (authCtx.adapter.create as any)({
      model: "agent",
      data: {
        id: agentId,
        name: `Agent-${agentId.slice(0, 6)}`,
        userId,
        hostId: machineId,
        status: "active",
        mode: "autonomous",
        publicKey: jwk,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      forceAllowId: true,
    });

    // Grant capabilities
    for (const cap of ["task:claim", "task:review", "agent:usage"]) {
      await authCtx.adapter.create({
        model: "agentCapabilityGrant",
        data: {
          agentId,
          capability: cap,
          grantedBy: userId,
          deniedBy: null,
          expiresAt: null,
          status: "active",
          reason: null,
          constraints: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    const jwt = await new SignJWT({ sub: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(privateKey);

    const headers = new Headers({ Authorization: `Bearer ${jwt}` });
    const session = await auth.api.getAgentSession({ headers });

    expect(session).toBeTruthy();
    expect(session!.agent.capabilityGrants).toHaveLength(3);
    const capNames = session!.agent.capabilityGrants.map((g: any) => g.capability).sort();
    expect(capNames).toEqual(["agent:usage", "task:claim", "task:review"]);
  });
});
