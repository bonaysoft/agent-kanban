import { createLogger } from "./logger.js";
import type { AgentEvent } from "./providers/types.js";

const logger = createLogger("tunnel");

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Single WebSocket tunnel to the relay worker.
 * Daemon connects once on startup. All session events and history requests flow through this one connection.
 */
export class TunnelClient {
  private ws: WebSocket | null = null;
  private humanMessageHandler?: (sessionId: string, content: string) => void;
  private historyRequestHandler?: (sessionId: string, requestId: string) => void;
  private reconnectAttempts = 0;
  private closed = false;
  private wsBaseUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.wsBaseUrl = apiUrl.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsBaseUrl}/api/tunnel/ws?role=daemon&token=${encodeURIComponent(this.apiKey)}`;

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      this.ws.addEventListener("open", () => {
        this.reconnectAttempts = 0;
        logger.info("Tunnel connected");
        resolve();
      });

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(String(event.data));
      });

      this.ws.addEventListener("close", () => {
        if (!this.closed && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++;
          logger.warn(`Tunnel disconnected, reconnecting (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(
            () => this.openSocket().catch((e) => logger.warn(`Reconnect failed: ${e instanceof Error ? e.message : e}`)),
            RECONNECT_DELAY_MS,
          );
        }
      });

      this.ws.addEventListener("error", () => {
        if (this.reconnectAttempts === 0) {
          reject(new Error("Tunnel connection failed"));
        }
      });
    });
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
