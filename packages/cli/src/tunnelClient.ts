import { createLogger } from "./logger.js";
import type { AgentEvent } from "./providers/types.js";

const logger = createLogger("tunnel");

const RECONNECT_DELAY_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * Single WebSocket tunnel to the relay worker.
 * Daemon connects once on startup. All session events and history requests flow through this one connection.
 *
 * Reconnect policy: keep trying forever until disconnect() is called. The daemon is a long-lived
 * process and the tunnel must always recover from transient failures (dev server restarts, network
 * blips, idle timeouts). A keepalive ping prevents idle proxies from dropping the socket.
 */
export class TunnelClient {
  private ws: WebSocket | null = null;
  private humanMessageHandler?: (sessionId: string, content: string) => void;
  private historyRequestHandler?: (sessionId: string, requestId: string) => void;
  private closed = false;
  private wsBaseUrl: string;
  private apiKey: string;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(apiUrl: string, apiKey: string) {
    this.wsBaseUrl = apiUrl.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    this.closed = false;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsBaseUrl}/api/tunnel/ws?role=daemon&token=${encodeURIComponent(this.apiKey)}`;

      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        settle(new Error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      this.ws = ws;

      ws.addEventListener("open", () => {
        logger.info("Tunnel connected");
        this.startKeepalive();
        settle();
      });

      ws.addEventListener("message", (event) => {
        this.handleMessage(String(event.data));
      });

      ws.addEventListener("close", (ev) => {
        this.stopKeepalive();
        // Always settle the promise so callers never hang.
        settle(new Error("Tunnel closed before open"));
        if (this.closed) return;
        logger.warn(`Tunnel disconnected (code=${ev.code} reason=${ev.reason || "none"}), reconnecting in ${RECONNECT_DELAY_MS}ms...`);
        setTimeout(() => {
          this.openSocket().catch((e) => {
            // Reconnect attempt couldn't even create the socket. Schedule another try
            // — `close` will not fire when the WebSocket constructor itself throws.
            logger.warn(`Reconnect failed: ${e instanceof Error ? e.message : e}`);
            if (!this.closed) setTimeout(() => this.openSocket().catch(() => {}), RECONNECT_DELAY_MS);
          });
        }, RECONNECT_DELAY_MS);
      });

      ws.addEventListener("error", () => {
        // Don't settle here — `close` always follows and handles cleanup + reconnect.
      });
    });
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* close handler will recover */
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
    // Don't keep the Node event loop alive just for the keepalive timer.
    if (this.keepaliveTimer && typeof (this.keepaliveTimer as { unref?: () => void }).unref === "function") {
      (this.keepaliveTimer as { unref: () => void }).unref();
    }
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case "human:message":
        this.humanMessageHandler?.(msg.sessionId as string, msg.content as string);
        break;
      case "request:history":
        this.historyRequestHandler?.(msg.sessionId as string, msg.requestId as string);
        break;
    }
  }

  sendEvent(sessionId: string, event: AgentEvent): void {
    this.send({ type: "agent:event", sessionId, event });
  }

  sendStatus(sessionId: string, status: "working" | "rate_limited" | "done"): void {
    this.send({ type: "agent:status", sessionId, status });
  }

  sendHistory(messages: unknown[], requestId: string): void {
    this.send({ type: "session:history", messages, requestId });
  }

  onHumanMessage(handler: (sessionId: string, content: string) => void): void {
    this.humanMessageHandler = handler;
  }

  onHistoryRequest(handler: (sessionId: string, requestId: string) => void): void {
    this.historyRequestHandler = handler;
  }

  disconnect(): void {
    this.closed = true;
    this.stopKeepalive();
    if (this.ws) {
      try {
        this.ws.close(1000, "daemon shutdown");
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
