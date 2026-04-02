export { TunnelRelay } from "./tunnelRelay";

interface Env {
  TUNNEL_RELAY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.TUNNEL_RELAY.idFromName("tunnel");
      return env.TUNNEL_RELAY.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
