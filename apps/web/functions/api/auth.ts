import type { Context, Next } from "hono";
import type { ApiKey } from "@agent-kanban/shared";
import type { Env } from "./types";

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateToken(db: D1Database, token: string): Promise<ApiKey | null> {
  const hash = await hashKey(token);
  return db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").bind(hash).first<ApiKey>();
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" } }, 401);
  }

  const key = await validateToken(c.env.DB, header.slice(7));

  if (!key) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, 401);
  }

  c.set("apiKey", key);
  await next();
}

export async function generateApiKey(db: D1Database, name: string | null): Promise<{ key: string; record: ApiKey }> {
  const rawKey = `ak_${crypto.randomUUID().replace(/-/g, "")}`;
  const hash = await hashKey(rawKey);
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO api_keys (id, key_hash, name, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, hash, name, now).run();

  return {
    key: rawKey,
    record: { id, key_hash: hash, name, created_at: now },
  };
}

export async function revokeApiKey(db: D1Database, keyId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM api_keys WHERE id = ?").bind(keyId).run();
  return result.meta.changes > 0;
}

export async function listApiKeys(db: D1Database): Promise<Omit<ApiKey, "key_hash">[]> {
  const result = await db.prepare(
    "SELECT id, name, created_at FROM api_keys ORDER BY created_at DESC"
  ).all<Omit<ApiKey, "key_hash">>();
  return result.results;
}
