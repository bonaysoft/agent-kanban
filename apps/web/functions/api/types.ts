import type { Session, User } from "better-auth";

export interface Env {
  DB: D1Database;
  RELAY: Fetcher;
  AUTH_SECRET: string;
  ALLOWED_HOSTS: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  MAILS_ADMIN_TOKEN: string;
}

declare module "hono" {
  interface ContextVariableMap {
    ownerId: string;
    identityType: "user" | "machine" | "agent:worker" | "agent:leader";
    apiKeyId?: string;
    machineId?: string;
    agentId?: string;
    sessionId?: string;
    agentCapabilities?: string[];
    user?: User;
    session?: Session;
  }
}
