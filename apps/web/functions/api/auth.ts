import type { Context, Next } from "hono";
import type { Env } from "./types";
import { createAuth } from "./betterAuth";

function detectTokenType(token: string): "apikey" | "agent" | "user" {
  if (token.startsWith("ak_")) return "apikey";
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const header = JSON.parse(atob(parts[0]));
      if (header.typ === "agent+jwt") return "agent";
    } catch { /* not a valid JWT header */ }
  }
  return "user";
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
  if (!token) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Missing token" } }, 401);
  }

  const auth = createAuth(c.env);
  const type = detectTokenType(token);

  if (type === "apikey") {
    return handleApiKey(c, auth, token, next);
  }

  // Build headers with the token for BA API calls (handles both header and query param tokens)
  const authHeaders = new Headers({ Authorization: `Bearer ${token}` });

  if (type === "agent") {
    const agentIdentity = await auth.api.getAgentSession({ headers: authHeaders });
    return handleAgentIdentity(c, agentIdentity, next);
  }

  const session = await auth.api.getSession({ headers: authHeaders });
  if (session) {
    c.set("ownerId", session.user.id);
    c.set("identityType", "user");
    c.set("user", session.user);
    c.set("session", session.session);
    return next();
  }

  return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } }, 401);
}

async function handleApiKey(c: Context<{ Bindings: Env }>, auth: any, token: string, next: Next) {
  const result = await auth.api.verifyApiKey({ body: { key: token } });
  if (!result?.valid) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, 401);
  }

  c.set("ownerId", result.key.userId);
  c.set("identityType", "machine");
  c.set("apiKeyId", result.key.id);
  const metadata = result.key.metadata as Record<string, any> | null;
  if (metadata?.machineId) c.set("machineId", metadata.machineId);
  return next();
}

function handleAgentIdentity(c: Context<{ Bindings: Env }>, identity: any, next: Next) {
  c.set("ownerId", identity.host?.userId || identity.user?.id);
  c.set("identityType", "agent");
  c.set("agentId", identity.agent.id);
  c.set("machineId", identity.agent.hostId);
  return next();
}

export function requireUser(c: Context) {
  if (c.get("identityType") !== "user") {
    return c.json({ error: { code: "FORBIDDEN", message: "User session required" } }, 403);
  }
}

export function requireMachine(c: Context) {
  if (c.get("identityType") !== "machine") {
    return c.json({ error: { code: "FORBIDDEN", message: "Machine API key required" } }, 403);
  }
}

export function requireAgent(c: Context) {
  if (c.get("identityType") !== "agent") {
    return c.json({ error: { code: "FORBIDDEN", message: "Agent session required" } }, 403);
  }
}

