import type { Context, Next } from "hono";
import type { Machine } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";
import type { Env } from "./types";
import { createAuth } from "./betterAuth";

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

  const token = header.slice(7);

  // Machine API key (ak_ prefix)
  if (token.startsWith("ak_")) {
    const machine = await validateToken(c.env.DB, token);
    if (!machine) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, 401);
    }
    c.set("machine", machine);
    return next();
  }

  // Better-auth session token
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
    c.set("machine", { id: "web", owner_id: session.user.id, key_hash: "", name: "web", status: "online", os: null, version: null, runtimes: null, last_heartbeat_at: null, created_at: "" } as Machine);
    return next();
  }

  return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } }, 401);
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
    machine: { id, owner_id: ownerId, key_hash: hash, name, status: "offline", os: null, version: null, runtimes: null, last_heartbeat_at: null, created_at: now },
  };
}

export async function revokeMachine(db: D1Database, machineId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM machines WHERE id = ?").bind(machineId).run();
  return result.meta.changes > 0;
}
