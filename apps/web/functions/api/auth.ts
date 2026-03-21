import type { Context, Next } from "hono";
import type { Machine } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";
import type { Env } from "./types";

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateToken(db: D1Database, token: string): Promise<Machine | null> {
  const hash = await hashKey(token);
  return db.prepare("SELECT * FROM machines WHERE key_hash = ?").bind(hash).first<Machine>();
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" } }, 401);
  }

  const machine = await validateToken(c.env.DB, header.slice(7));

  if (!machine) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, 401);
  }

  c.set("machine", machine);
  await next();
}

export async function generateMachineKey(db: D1Database, ownerId: string, name: string): Promise<{ key: string; machine: Machine }> {
  const rawKey = `ak_${crypto.randomUUID().replace(/-/g, "")}`;
  const hash = await hashKey(rawKey);
  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO machines (id, owner_id, key_hash, name, status, last_heartbeat_at, created_at) VALUES (?, ?, ?, ?, 'offline', NULL, ?)"
  ).bind(id, ownerId, hash, name, now).run();

  return {
    key: rawKey,
    machine: { id, owner_id: ownerId, key_hash: hash, name, status: "offline", last_heartbeat_at: null, created_at: now },
  };
}

export async function revokeMachine(db: D1Database, machineId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM machines WHERE id = ?").bind(machineId).run();
  return result.meta.changes > 0;
}
