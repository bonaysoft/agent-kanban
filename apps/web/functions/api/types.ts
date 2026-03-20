import type { ApiKey } from "@agent-kanban/shared";

export interface Env {
  DB: D1Database;
}

declare module "hono" {
  interface ContextVariableMap {
    apiKey: ApiKey;
  }
}
