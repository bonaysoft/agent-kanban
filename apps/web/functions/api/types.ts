import type { Session, User } from "better-auth";

export interface Env {
  DB: D1Database;
  AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

declare module "hono" {
  interface ContextVariableMap {
    ownerId: string;
    identityType: "user" | "machine" | "agent";
    apiKeyId?: string;
    machineId?: string;
    agentId?: string;
    agentCapabilities?: string[];
    user?: User;
    session?: Session;
  }
}
