export { TunnelRelay } from "./tunnelRelay";

interface Env {
  TUNNEL_RELAY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      // Each owner gets their own DO — isolates daemon/browser connections
      // between users so one user's daemon doesn't supersede another's.
      const ownerId = url.searchParams.get("ownerId");
      if (!ownerId) return new Response("Missing ownerId", { status: 400 });
      const id = env.TUNNEL_RELAY.idFromName(ownerId);
      return env.TUNNEL_RELAY.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
