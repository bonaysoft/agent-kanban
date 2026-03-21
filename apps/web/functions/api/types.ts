import type { Machine } from "@agent-kanban/shared";
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
    machine: Machine;
    user: User;
    session: Session;
  }
}
