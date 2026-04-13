import { agentAuth } from "@better-auth/agent-auth";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./types";

export function createAuth(env: Env) {
  return betterAuth({
    database: {
      db: new Kysely({ dialect: new D1Dialect({ database: env.DB }) }),
      type: "sqlite",
    },
    basePath: "/api/auth",
    baseURL: {
      allowedHosts: env.ALLOWED_HOSTS.split(","),
      fallback: `https://${env.ALLOWED_HOSTS.split(",")[0]}`,
      protocol: "auto",
    },
    secret: env.AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        scope: ["user", "admin:gpg_key"],
      },
    },
    plugins: [
      bearer(),
      // Admin plugin enables /api/auth/admin/* endpoints (list-users, ban-user, set-role, etc.)
      // First admin must be set manually via D1 console:
      //   UPDATE user SET role = 'admin' WHERE email = '...'
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
      }),
      apiKey({
        defaultPrefix: "ak_",
        enableMetadata: true,
        rateLimit: { enabled: false },
      }),
      agentAuth({
        allowedKeyAlgorithms: ["Ed25519"],
        agentSessionTTL: 86400,
        agentMaxLifetime: 86400,
        allowDynamicHostRegistration: true,
        modes: ["autonomous"],
        rateLimit: {
          "/agent/session": { window: 60, max: 6000 },
        },
        capabilities: [
          { name: "task:claim", description: "Claim an assigned task" },
          { name: "task:review", description: "Submit a task for review" },
          { name: "task:complete", description: "Complete a task in review" },
          { name: "task:reject", description: "Reject a task back to in-progress" },
          { name: "task:cancel", description: "Cancel a task" },
          { name: "task:log", description: "Add logs to a task" },
          { name: "task:message", description: "Send and read task messages" },
          { name: "agent:usage", description: "Report token usage" },
        ],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
