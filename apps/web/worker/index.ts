export { TunnelRelay } from "../server/tunnelRelay";

import { createLogger } from "../server/logger";
import { detectStaleMachines } from "../server/machineRepo";
import { api } from "../server/routes";
import { detectAndReleaseStaleAll } from "../server/taskStale";
import type { Env } from "../server/types";

const logger = createLogger("scheduled");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return api.fetch(request, env);
  },

  // Stale-sweep cron — replaces per-request write-on-read detection that used
  // to fire on every GET /api/boards/:id and every machine listing. Fires
  // every minute so the detection window is roughly aligned with
  // MACHINE_STALE_TIMEOUT_MS (60s). Errors in one sweep don't block the other.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      Promise.all([
        detectStaleMachines(env.DB).catch((err) => logger.warn(`detectStaleMachines failed: ${err}`)),
        detectAndReleaseStaleAll(env.DB).catch((err) => logger.warn(`detectAndReleaseStaleAll failed: ${err}`)),
      ]),
    );
  },
};
