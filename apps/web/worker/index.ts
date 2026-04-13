export { TunnelRelay } from "../server/tunnelRelay";

import { api } from "../server/routes";
import type { Env } from "../server/types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return api.fetch(request, env);
  },
};
