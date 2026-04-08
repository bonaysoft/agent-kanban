// @vitest-environment node
/**
 * Unit tests for TunnelRelay Durable Object.
 *
 * All Cloudflare DO APIs (DurableObjectState, WebSocketPair, etc.) are mocked
 * here — no real Workers runtime is needed.
 */

import { describe, expect, it, vi } from "vitest";

// ── WebSocketPair mock ────────────────────────────────────────────────────────

class MockWebSocket {
  readyState = 1;
  private _listeners: Record<string, Array<(e: unknown) => void>> = {};
  sentMessages: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  tags: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = { code, reason };
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  // Test helper: reset sent messages
  clearMessages(): void {
    this.sentMessages = [];
  }
}

class MockWebSocketPair {
  0: MockWebSocket;
  1: MockWebSocket;

  constructor() {
    this[0] = new MockWebSocket();
    this[1] = new MockWebSocket();
  }
}

// ── DurableObjectState mock ───────────────────────────────────────────────────

class MockDurableObjectState {
  private _sockets: MockWebSocket[] = [];

  getWebSockets(tag?: string): MockWebSocket[] {
    if (tag === undefined) return [...this._sockets];
    return this._sockets.filter((ws) => ws.tags.includes(tag));
  }

  acceptWebSocket(ws: MockWebSocket, tags: string[]): void {
    ws.tags = tags;
    this._sockets.push(ws);
  }

  getTags(ws: MockWebSocket): string[] {
    return ws.tags;
  }

  // Helper to remove a socket (simulate close)
  _removeSocket(ws: MockWebSocket): void {
    this._sockets = this._sockets.filter((s) => s !== ws);
  }
}

// ── CF-specific Response mock (accepts status 101 + webSocket init option) ────
//
// The standard WHATWG Response rejects status 101.  Cloudflare Workers extend
// Response to accept WebSocket upgrades.  We replace the global Response with a
// thin wrapper that stores the webSocket option so tests can retrieve it.

class CFResponse {
  status: number;
  webSocket: unknown;
  _body: unknown;

  constructor(body: unknown, init: Record<string, unknown> = {}) {
    // Allow 101 for WebSocket upgrades
    this.status = (init.status as number) ?? 200;
    this.webSocket = init.webSocket ?? null;
    this._body = body;
  }
}

(globalThis as any).Response = CFResponse;

// ── Inject globals before module import ──────────────────────────────────────

(globalThis as any).WebSocketPair = MockWebSocketPair;

// Spy on crypto.randomUUID — cannot replace the getter, so we spy on the method
vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("test-uuid-1234" as `${string}-${string}-${string}-${string}-${string}`);

import { TunnelRelay } from "../packages/relay-worker/src/tunnelRelay.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(role: string, sessionId?: string): Request {
  const url = new URL("https://relay.example.com/ws");
  url.searchParams.set("role", role);
  if (sessionId) url.searchParams.set("sessionId", sessionId);
  return new Request(url.toString(), {
    headers: { Upgrade: "websocket" },
  });
}

function makeRelay(): { relay: TunnelRelay; state: MockDurableObjectState } {
  const state = new MockDurableObjectState();
  const relay = new TunnelRelay(state as unknown as DurableObjectState, {});
  return { relay, state };
}

/**
 * Connect daemon to the relay and return the **server-side** WebSocket
 * (pair[1]) that the DO stores in state — this is the socket the relay
 * uses for identity comparison in handleDaemonMessage / webSocketClose.
 */
async function connectDaemon(relay: TunnelRelay, state: MockDurableObjectState): Promise<MockWebSocket> {
  const _countBefore = state.getWebSockets("daemon").length;
  const req = makeRequest("daemon");
  const resp = await relay.fetch(req);
  expect(resp.status).toBe(101);
  // Return the newly-accepted daemon socket from state
  const all = state.getWebSockets("daemon");
  return all[all.length - 1];
}

/**
 * Connect a browser with a given sessionId and return the **server-side**
 * WebSocket (pair[1]) stored in state.
 */
async function connectBrowser(relay: TunnelRelay, state: MockDurableObjectState, sessionId: string): Promise<MockWebSocket> {
  const _countBefore = state.getWebSockets(sessionId).length;
  const req = makeRequest("browser", sessionId);
  const resp = await relay.fetch(req);
  expect(resp.status).toBe(101);
  const all = state.getWebSockets(sessionId);
  return all[all.length - 1];
}

// ── fetch() routing ───────────────────────────────────────────────────────────

describe("TunnelRelay.fetch() — routing", () => {
  it("returns 426 when Upgrade header is missing", async () => {
    const { relay } = makeRelay();
    const req = new Request("https://relay.example.com/ws?role=daemon");
    const resp = await relay.fetch(req);
    expect(resp.status).toBe(426);
  });

  it("returns 400 when role is daemon but uses wrong casing", async () => {
    const { relay } = makeRelay();
    const req = new Request("https://relay.example.com/ws?role=DAEMON", {
      headers: { Upgrade: "websocket" },
    });
    const resp = await relay.fetch(req);
    expect(resp.status).toBe(400);
  });

  it("returns 400 when role is browser but sessionId is missing", async () => {
    const { relay } = makeRelay();
    const req = makeRequest("browser"); // no sessionId
    const resp = await relay.fetch(req);
    expect(resp.status).toBe(400);
  });

  it("returns 400 for unknown role value", async () => {
    const { relay } = makeRelay();
    const req = makeRequest("unknown-role");
    const resp = await relay.fetch(req);
    expect(resp.status).toBe(400);
  });

  it("returns 101 for valid daemon connect", async () => {
    const { relay } = makeRelay();
    const resp = await relay.fetch(makeRequest("daemon"));
    expect(resp.status).toBe(101);
  });

  it("returns 101 for valid browser connect with sessionId", async () => {
    const { relay } = makeRelay();
    const resp = await relay.fetch(makeRequest("browser", "session-1"));
    expect(resp.status).toBe(101);
  });
});

// ── connectDaemon() ───────────────────────────────────────────────────────────

describe("TunnelRelay — connectDaemon()", () => {
  it("accepts the server socket with daemon tag", async () => {
    const { relay, state } = makeRelay();
    await relay.fetch(makeRequest("daemon"));
    const daemonSockets = state.getWebSockets("daemon");
    expect(daemonSockets).toHaveLength(1);
  });

  it("broadcasts daemon:connected to all browsers when daemon connects", async () => {
    const { relay, state } = makeRelay();
    // Connect two browsers first
    const b1 = await connectBrowser(relay, state, "s1");
    const b2 = await connectBrowser(relay, state, "s2");
    b1.clearMessages();
    b2.clearMessages();
    // Connect daemon
    await connectDaemon(relay, state);
    const b1Msgs = b1.sentMessages.map((m) => JSON.parse(m));
    const b2Msgs = b2.sentMessages.map((m) => JSON.parse(m));
    expect(b1Msgs.some((m: any) => m.type === "daemon:connected")).toBe(true);
    expect(b2Msgs.some((m: any) => m.type === "daemon:connected")).toBe(true);
  });

  it("does not close the existing daemon socket when a new daemon connects (avoids close-frame misrouting)", async () => {
    const { relay, state } = makeRelay();
    // First daemon connects
    await relay.fetch(makeRequest("daemon"));
    const firstDaemon = state.getWebSockets("daemon")[0];
    // Second daemon connects
    await relay.fetch(makeRequest("daemon"));
    // Stale socket is left open — closing it under Hibernation API can
    // misroute the close frame to the new client connection.
    expect(firstDaemon.closedWith).toBeNull();
    // Both sockets are tagged "daemon"; getDaemonWs returns the latest
    expect(state.getWebSockets("daemon")).toHaveLength(2);
  });
});

// ── connectBrowser() ─────────────────────────────────────────────────────────

describe("TunnelRelay — connectBrowser()", () => {
  it("accepts the server socket with the sessionId tag", async () => {
    const { relay, state } = makeRelay();
    await relay.fetch(makeRequest("browser", "my-session"));
    const sockets = state.getWebSockets("my-session");
    expect(sockets).toHaveLength(1);
  });

  it("immediately sends daemon:connected when daemon is already present", async () => {
    const { relay, state } = makeRelay();
    await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "sess-1");
    const msgs = browser.sentMessages.map((m) => JSON.parse(m));
    expect(msgs.some((m: any) => m.type === "daemon:connected")).toBe(true);
  });

  it("immediately sends daemon:disconnected when daemon is not present", async () => {
    const { relay, state } = makeRelay();
    const browser = await connectBrowser(relay, state, "sess-1");
    const msgs = browser.sentMessages.map((m) => JSON.parse(m));
    expect(msgs.some((m: any) => m.type === "daemon:disconnected")).toBe(true);
  });
});

// ── Daemon message routing ────────────────────────────────────────────────────

describe("TunnelRelay — daemon message routing", () => {
  it("forwards agent:event to the matching browser session", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browserA = await connectBrowser(relay, state, "session-A");
    const browserB = await connectBrowser(relay, state, "session-B");
    browserA.clearMessages();
    browserB.clearMessages();

    const msg = JSON.stringify({ type: "agent:event", sessionId: "session-A", event: { type: "error", detail: "boom" } });
    relay.webSocketMessage(daemonWs as unknown as WebSocket, msg);

    expect(browserA.sentMessages).toHaveLength(1);
    expect(browserB.sentMessages).toHaveLength(0);
  });

  it("forwards agent:status to the matching browser session", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "sess-1");
    browser.clearMessages();

    relay.webSocketMessage(daemonWs as unknown as WebSocket, JSON.stringify({ type: "agent:status", sessionId: "sess-1", status: "working" }));

    expect(browser.sentMessages).toHaveLength(1);
    const parsed = JSON.parse(browser.sentMessages[0]);
    expect(parsed.type).toBe("agent:status");
    expect(parsed.status).toBe("working");
  });

  it("does not deliver agent:event to browsers on a different sessionId", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browserB = await connectBrowser(relay, state, "session-B");
    browserB.clearMessages();

    relay.webSocketMessage(
      daemonWs as unknown as WebSocket,
      JSON.stringify({ type: "agent:event", sessionId: "session-A", event: { type: "error", detail: "x" } }),
    );

    expect(browserB.sentMessages).toHaveLength(0);
  });

  it("routes session:history response back to the requesting browser", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "sess-1");
    browser.clearMessages();

    // Browser requests history
    relay.webSocketMessage(browser as unknown as WebSocket, JSON.stringify({ type: "request:history" }));

    // Daemon replies with session:history and the requestId
    relay.webSocketMessage(
      daemonWs as unknown as WebSocket,
      JSON.stringify({ type: "session:history", requestId: "test-uuid-1234", messages: ["msg1"] }),
    );

    expect(browser.sentMessages).toHaveLength(1);
    const parsed = JSON.parse(browser.sentMessages[0]);
    expect(parsed.type).toBe("session:history");
    expect(parsed.messages).toEqual(["msg1"]);
  });

  it("ignores non-string (binary) messages", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    // Should not throw
    expect(() => relay.webSocketMessage(daemonWs as unknown as WebSocket, new ArrayBuffer(4))).not.toThrow();
  });

  it("ignores messages that are not valid JSON", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    expect(() => relay.webSocketMessage(daemonWs as unknown as WebSocket, "not json")).not.toThrow();
  });
});

// ── Browser message routing ───────────────────────────────────────────────────

describe("TunnelRelay — browser message routing", () => {
  it("forwards human:message to the daemon with the browser's sessionId", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "sess-42");
    daemonWs.clearMessages();

    relay.webSocketMessage(browser as unknown as WebSocket, JSON.stringify({ type: "human:message", content: "hello agent" }));

    expect(daemonWs.sentMessages).toHaveLength(1);
    const fwd = JSON.parse(daemonWs.sentMessages[0]);
    expect(fwd.type).toBe("human:message");
    expect(fwd.sessionId).toBe("sess-42");
    expect(fwd.content).toBe("hello agent");
  });

  it("does not forward human:message when daemon is not connected", async () => {
    const { relay, state } = makeRelay();
    const browser = await connectBrowser(relay, state, "sess-1");
    // No daemon present — should not throw
    expect(() => relay.webSocketMessage(browser as unknown as WebSocket, JSON.stringify({ type: "human:message", content: "hi" }))).not.toThrow();
  });

  it("sends request:history to daemon with a generated requestId", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "sess-1");
    daemonWs.clearMessages();

    relay.webSocketMessage(browser as unknown as WebSocket, JSON.stringify({ type: "request:history" }));

    expect(daemonWs.sentMessages).toHaveLength(1);
    const fwd = JSON.parse(daemonWs.sentMessages[0]);
    expect(fwd.type).toBe("request:history");
    expect(fwd.sessionId).toBe("sess-1");
    expect(typeof fwd.requestId).toBe("string");
  });

  it("does not forward request:history when daemon is not connected", async () => {
    const { relay, state } = makeRelay();
    const browser = await connectBrowser(relay, state, "sess-1");
    expect(() => relay.webSocketMessage(browser as unknown as WebSocket, JSON.stringify({ type: "request:history" }))).not.toThrow();
  });
});

// ── webSocketClose / webSocketError ──────────────────────────────────────────

describe("TunnelRelay — webSocketClose()", () => {
  it("broadcasts daemon:disconnected to all browsers when daemon socket closes", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser1 = await connectBrowser(relay, state, "s1");
    const browser2 = await connectBrowser(relay, state, "s2");
    browser1.clearMessages();
    browser2.clearMessages();

    relay.webSocketClose(daemonWs as unknown as WebSocket);

    const b1Msgs = browser1.sentMessages.map((m) => JSON.parse(m));
    const b2Msgs = browser2.sentMessages.map((m) => JSON.parse(m));
    expect(b1Msgs.some((m: any) => m.type === "daemon:disconnected")).toBe(true);
    expect(b2Msgs.some((m: any) => m.type === "daemon:disconnected")).toBe(true);
  });

  it("does not broadcast when a browser socket (not daemon) closes", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "sess-1");
    const otherBrowser = await connectBrowser(relay, state, "sess-2");
    otherBrowser.clearMessages();
    daemonWs.clearMessages();

    relay.webSocketClose(browser as unknown as WebSocket);

    // daemon and other browser should not receive disconnected message
    expect(daemonWs.sentMessages).toHaveLength(0);
    expect(otherBrowser.sentMessages).toHaveLength(0);
  });
});

describe("TunnelRelay — webSocketError()", () => {
  it("broadcasts daemon:disconnected to all browsers when daemon socket errors", async () => {
    const { relay, state } = makeRelay();
    const daemonWs = await connectDaemon(relay, state);
    const browser = await connectBrowser(relay, state, "s1");
    browser.clearMessages();

    relay.webSocketError(daemonWs as unknown as WebSocket);

    const msgs = browser.sentMessages.map((m) => JSON.parse(m));
    expect(msgs.some((m: any) => m.type === "daemon:disconnected")).toBe(true);
  });
});
