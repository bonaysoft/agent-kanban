import type { Machine } from "@agent-kanban/shared";

export interface Env {
  DB: D1Database;
}

declare module "hono" {
  interface ContextVariableMap {
    machine: Machine;
  }
}
