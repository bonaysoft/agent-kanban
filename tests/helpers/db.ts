import { Miniflare } from "miniflare";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(__dirname, "../../apps/web/migrations");

export function createTestEnv() {
  return {
    DB: null as any as D1Database,
    AUTH_SECRET: "test-secret-32-chars-minimum-ok!!",
    ALLOWED_HOSTS: "localhost:8788",
    GITHUB_CLIENT_ID: "x",
    GITHUB_CLIENT_SECRET: "x",
  };
}

export async function applyMigrations(db: D1Database) {
  const files = ["0001_initial.sql"];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(stmt).run();
    }
  }
}

export async function seedUser(db: D1Database, id: string, email: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)"
    )
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
