// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "fs";
import { join } from "path";
import { BUILTIN_TEMPLATES } from "@agent-kanban/shared";

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";

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

async function seedUser(db: D1Database, id: string, email: string): Promise<string> {
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)"
  ).bind(id, "Test User", email, now, now).run();
  return id;
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

describe("builtin agents", () => {
  const userId = "user-builtin";

  it("createBoard seeds builtin agents", async () => {
    await seedUser(env.DB, userId, "builtin@test.com");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    await createBoard(env.DB, userId, "Test Board");

    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const builtins = agents.filter((a) => a.builtin);

    expect(builtins).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(builtins[0].role).toBe("quality-goalkeeper");
    expect(builtins[0].name).toBe("Quality Goalkeeper");
    expect(builtins[0].builtin).toBe(1);
  });

  it("second board does not duplicate builtin agents", async () => {
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    await createBoard(env.DB, userId, "Second Board");

    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const builtins = agents.filter((a) => a.builtin);

    expect(builtins).toHaveLength(BUILTIN_TEMPLATES.length);
  });

  it("builtin agent has valid keypair and fingerprint", async () => {
    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const builtin = agents.find((a) => a.builtin);

    expect(builtin!.public_key).toBeTruthy();
    expect(builtin!.fingerprint).toBeTruthy();
    expect(builtin!.fingerprint).toHaveLength(64);
  });

  it("different tenant gets separate builtin agents", async () => {
    const otherUserId = "user-builtin-other";
    await seedUser(env.DB, otherUserId, "other@test.com");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    await createBoard(env.DB, otherUserId, "Other Board");

    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(env.DB, otherUserId);
    const builtins = agents.filter((a) => a.builtin);

    expect(builtins).toHaveLength(BUILTIN_TEMPLATES.length);

    // Different tenant → different agent IDs (different keypairs)
    const firstTenantAgents = await listAgents(env.DB, userId);
    const firstBuiltin = firstTenantAgents.find((a) => a.builtin);
    expect(builtins[0].id).not.toBe(firstBuiltin!.id);
  });
});
