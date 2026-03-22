import type { Context, Next } from "hono";
import type { Env } from "./types";
import { createAuth } from "./betterAuth";

type IdentityType = "user" | "machine" | "agent";

interface RouteRule {
  allow: IdentityType[];
  capability?: string; // required agent capability (only checked for "agent")
}

// Route permission rules: method + path pattern → allowed identity types + required capability
// Routes not listed here are open to any authenticated identity.
const ROUTE_RULES: { method: string; pattern: RegExp; rule: RouteRule }[] = [
  // Machines — machine-only
  { method: "POST", pattern: /^\/api\/machines$/, rule: { allow: ["machine"] } },
  { method: "POST", pattern: /^\/api\/machines\/[^/]+\/heartbeat$/, rule: { allow: ["machine"] } },
  { method: "DELETE", pattern: /^\/api\/machines\/[^/]+$/, rule: { allow: ["user"] } },

  // Agents — machine registers, agent acts
  { method: "POST", pattern: /^\/api\/agents$/, rule: { allow: ["machine"] } },
  { method: "PATCH", pattern: /^\/api\/agents\/[^/]+\/usage$/, rule: { allow: ["agent"], capability: "agent:usage" } },

  // Task lifecycle
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/claim$/, rule: { allow: ["agent"], capability: "task:claim" } },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/review$/, rule: { allow: ["agent"], capability: "task:review" } },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/assign$/, rule: { allow: ["machine"] } },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/release$/, rule: { allow: ["machine"] } },
];

function matchRouteRule(method: string, path: string): RouteRule | null {
  for (const { method: m, pattern, rule } of ROUTE_RULES) {
    if (m === method && pattern.test(path)) return rule;
  }
  return null;
}

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
    return enforceRouteRule(c, next);
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
  return enforceRouteRule(c, next);
}

function handleAgentIdentity(c: Context<{ Bindings: Env }>, identity: any, next: Next) {
  c.set("ownerId", identity.host?.userId || identity.user?.id);
  c.set("identityType", "agent");
  c.set("agentId", identity.agent.id);
  c.set("machineId", identity.agent.hostId);
  const caps = (identity.agent.capabilityGrants || []).map((g: any) => g.capability as string);
  c.set("agentCapabilities", caps);
  return enforceRouteRule(c, next);
}

function enforceRouteRule(c: Context<{ Bindings: Env }>, next: Next) {
  const rule = matchRouteRule(c.req.method, c.req.path);
  if (!rule) return next(); // no rule = open to any authenticated identity

  const identity = c.get("identityType") as IdentityType;
  if (!rule.allow.includes(identity)) {
    return c.json({ error: { code: "FORBIDDEN", message: `${rule.allow.join(" or ")} required` } }, 403);
  }

  if (rule.capability && identity === "agent") {
    const caps: string[] = c.get("agentCapabilities") || [];
    if (!caps.includes(rule.capability)) {
      return c.json({ error: { code: "FORBIDDEN", message: `Missing capability: ${rule.capability}` } }, 403);
    }
  }

  return next();
}

