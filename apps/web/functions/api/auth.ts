import type { Context, Next } from "hono";
import type { Env } from "./types";
import { createAuth } from "./betterAuth";

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" } }, 401);
  }

  const token = header.slice(7);
  const auth = createAuth(c.env);

  // Machine API key (ak_ prefix)
  if (token.startsWith("ak_")) {
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

  // Better-auth session token
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("ownerId", session.user.id);
    c.set("identityType", "user");
    c.set("user", session.user);
    c.set("session", session.session);
    return next();
  }

  return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } }, 401);
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
