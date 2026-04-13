import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateAgentInput } from "@agent-kanban/shared";
import { Miniflare } from "miniflare";

const MIGRATIONS_DIR = join(__dirname, "../../apps/web/migrations");

export function createTestEnv() {
  return {
    DB: null as any as D1Database,
    AE: { writeDataPoint: () => {} } as unknown as AnalyticsEngineDataset,
    AUTH_SECRET: "test-secret-32-chars-minimum-ok!!",
    ALLOWED_HOSTS: "localhost:8788",
    GITHUB_CLIENT_ID: "x",
    GITHUB_CLIENT_SECRET: "x",
    MAILS_ADMIN_TOKEN: "",
  };
}

export async function applyMigrations(db: D1Database) {
  const files = [
    "0001_initial.sql",
    "0002_rename_task_logs_to_task_notes.sql",
    "0003_agent_kind.sql",
    "0004_rename_task_notes_to_task_actions.sql",
    "0005_agent_runtime_required.sql",
    "0006_add_device_id.sql",
    "0007_task_seq.sql",
    "0008_board_sharing.sql",
    "0009_admin_fields.sql",
    "0010_board_type.sql",
    "0011_task_scheduled_at.sql",
    "0012_gpg_keys.sql",
    "0013_agent_identity.sql",
    "0014_agent_mailbox_token.sql",
    "0015_username_global_unique.sql",
    "0016_task_actions_session_id.sql",
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

export async function seedUser(db: D1Database, id: string, email: string) {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(id, "Test User", email, now, now)
    .run();
}

export async function setupMiniflare() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  const db = await mf.getD1Database("DB");
  await applyMigrations(db);
  return { mf, db };
}

/** Ensure user row exists + create agent with GPG identity. Drop-in replacement for bare createAgent() in tests. */
export async function createTestAgent(db: D1Database, ownerId: string, input: CreateAgentInput, builtin = false) {
  // Ensure user row exists (idempotent)
  const existing = await db.prepare("SELECT 1 FROM user WHERE id = ?").bind(ownerId).first();
  if (!existing) await seedUser(db, ownerId, `${ownerId}@test.local`);

  const { createAgent, createAgentIdentity } = await import("../../apps/web/server/agentRepo");
  const identity = await createAgentIdentity(db, ownerId, `${input.username}@mails.agent-kanban.dev`);
  return createAgent(db, ownerId, input, identity, builtin);
}
