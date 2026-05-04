// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_TEMPLATES } from "@agent-kanban/shared";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";

const env = {
  DB: null as any as D1Database,
  AE: { writeDataPoint: () => {} } as unknown as AnalyticsEngineDataset,
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
    "0012_gpg_keys.sql",
    "0013_agent_identity.sql",
    "0014_agent_mailbox_token.sql",
    "0015_username_global_unique.sql",
    "0016_task_actions_session_id.sql",
    "0017_unique_leader_per_runtime.sql",
    "0018_agent_subagents.sql",
    "0019_agent_versions.sql",
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

async function seedUser(db: D1Database, id: string, email: string): Promise<string> {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(id, "Test User", email, now, now)
    .run();
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
    const { createBoard } = await import("../apps/web/server/boardRepo");
    await createBoard(env.DB, userId, "Test Board", "dev");

    const { listAgents } = await import("../apps/web/server/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const builtins = agents.filter((a) => a.builtin);

    expect(builtins).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(builtins[0].role).toBe("quality-goalkeeper");
    expect(builtins[0].name).toBe("Quality Goalkeeper");
    expect(builtins[0].builtin).toBe(1);
  });

  it("second board does not duplicate builtin agents", async () => {
    const { createBoard } = await import("../apps/web/server/boardRepo");
    await createBoard(env.DB, userId, "Second Board", "dev");

    const { listAgents } = await import("../apps/web/server/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const builtins = agents.filter((a) => a.builtin);

    expect(builtins).toHaveLength(BUILTIN_TEMPLATES.length);
  });

  it("builtin agent has valid keypair and fingerprint", async () => {
    const { listAgents } = await import("../apps/web/server/agentRepo");
    const agents = await listAgents(env.DB, userId);
    const builtin = agents.find((a) => a.builtin);

    expect(builtin!.public_key).toBeTruthy();
    expect(builtin!.fingerprint).toBeTruthy();
    expect(builtin!.fingerprint).toHaveLength(40); // GPG v4 fingerprint (SHA-1)
  });

  it("different tenant gets separate builtin agents", async () => {
    const otherUserId = "user-builtin-other";
    await seedUser(env.DB, otherUserId, "other@test.com");
    const { createBoard } = await import("../apps/web/server/boardRepo");
    await createBoard(env.DB, otherUserId, "Other Board", "dev");

    const { listAgents } = await import("../apps/web/server/agentRepo");
    const agents = await listAgents(env.DB, otherUserId);
    const builtins = agents.filter((a) => a.builtin);

    expect(builtins).toHaveLength(BUILTIN_TEMPLATES.length);

    // Different tenant → different agent IDs (different keypairs)
    const firstTenantAgents = await listAgents(env.DB, userId);
    const firstBuiltin = firstTenantAgents.find((a) => a.builtin);
    expect(builtins[0].id).not.toBe(firstBuiltin!.id);
  });
});
