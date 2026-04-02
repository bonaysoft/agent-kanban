/**
 * TunnelRelay — Single Durable Object that tunnels all communication between
 * daemon and browsers.
 *
 * Uses Hibernation API: WebSocket state is recovered from tags after wake-up.
 * Tags: ["daemon"] for daemon WS, [sessionId] for browser WS.
 */

export class TunnelRelay implements DurableObject {
  private pendingHistory = new Map<string, WebSocket>();

  constructor(
    private state: DurableObjectState,
    _env: unknown,
  ) {}

  private getDaemonWs(): WebSocket | null {
    const sockets = this.state.getWebSockets("daemon");
    return sockets.length > 0 ? sockets[0] : null;
  }

  private getBrowserSockets(sessionId?: string): WebSocket[] {
    if (sessionId) {
      return this.state.getWebSockets(sessionId);
    }
    const all = this.state.getWebSockets();
    const daemonSet = new Set(this.state.getWebSockets("daemon"));
    return all.filter((ws) => !daemonSet.has(ws));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const role = url.searchParams.get("role");
    const sessionId = url.searchParams.get("sessionId");

    if (role === "daemon") {
      return this.connectDaemon();
    }

    if (role === "browser" && sessionId) {
      return this.connectBrowser(sessionId);
    }

    return new Response("Invalid role or missing sessionId", { status: 400 });
  }

  private connectDaemon(): Response {
    for (const ws of this.state.getWebSockets("daemon")) {
      try {
        ws.close(1000, "replaced");
      } catch {
        /* already closed */
      }
    }

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], ["daemon"]);
    this.broadcastToBrowsers({ type: "daemon:connected" });

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private connectBrowser(sessionId: string): Response {
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [sessionId]);

    const daemon = this.getDaemonWs();
    pair[1].send(JSON.stringify({ type: daemon ? "daemon:connected" : "daemon:disconnected" }));

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    if (typeof data !== "string") return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    const daemon = this.getDaemonWs();
    if (ws === daemon) {
      this.handleDaemonMessage(msg);
    } else {
      this.handleBrowserMessage(ws, msg);
    }
  }

  private handleDaemonMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    // History response — send back to the requesting browser
    if (type === "session:history" && msg.requestId) {
      const browser = this.pendingHistory.get(msg.requestId as string);
      if (browser) {
        this.pendingHistory.delete(msg.requestId as string);
        try {
          browser.send(JSON.stringify(msg));
        } catch {
          /* browser gone */
        }
      }
      return;
    }

    // Agent event / status — forward to session subscribers
    if ((type === "agent:event" || type === "agent:status") && msg.sessionId) {
      const data = JSON.stringify(msg);
      for (const ws of this.getBrowserSockets(msg.sessionId as string)) {
        try {
          ws.send(data);
        } catch {
          /* browser gone */
        }
      }
      return;
    }
  }

  private handleBrowserMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    const daemon = this.getDaemonWs();

    if (msg.type === "human:message" && daemon) {
      const tags = this.state.getTags(ws);
      const sessionId = tags.find((t) => t !== "daemon");
      if (sessionId) {
        daemon.send(JSON.stringify({ ...msg, sessionId }));
      }
      return;
    }

    if (msg.type === "request:history" && daemon) {
      const tags = this.state.getTags(ws);
      const sessionId = tags.find((t) => t !== "daemon");
      if (sessionId) {
        const requestId = crypto.randomUUID();
        this.pendingHistory.set(requestId, ws);
        daemon.send(JSON.stringify({ type: "request:history", sessionId, requestId }));
        // Timeout cleanup
        setTimeout(() => this.pendingHistory.delete(requestId), 10000);
      }
      return;
    }
  }

  webSocketClose(ws: WebSocket): void {
    if (ws === this.getDaemonWs()) {
      this.broadcastToBrowsers({ type: "daemon:disconnected" });
    }
  }

  webSocketError(ws: WebSocket): void {
    if (ws === this.getDaemonWs()) {
      this.broadcastToBrowsers({ type: "daemon:disconnected" });
    }
  }

  private broadcastToBrowsers(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    for (const ws of this.getBrowserSockets()) {
      try {
        ws.send(data);
      } catch {
        /* browser gone */
      }
    }
  }
}
