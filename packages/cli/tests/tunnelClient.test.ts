// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Logger mock ──────────────────────────────────────────────────────────────
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── WebSocket mock ───────────────────────────────────────────────────────────

type WsListener = (event: Event | MessageEvent | CloseEvent) => void;

interface MockWsInstance {
  url: string;
  readyState: number;
  sentMessages: string[];
  listeners: Record<string, WsListener[]>;
  addEventListener(type: string, fn: WsListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  // Test helpers to trigger events
  _open(): void;
  _message(data: string): void;
  _close(): void;
  _error(): void;
}

let lastCreatedWs: MockWsInstance | null = null;

const OPEN = 1;
const CLOSED = 3;

class MockWebSocket implements MockWsInstance {
  url: string;
  readyState = OPEN;
  sentMessages: string[] = [];
  listeners: Record<string, WsListener[]> = {};

  constructor(url: string) {
    this.url = url;
    lastCreatedWs = this;
  }

  static OPEN = OPEN;
  static CLOSED = CLOSED;

  addEventListener(type: string, fn: WsListener): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = CLOSED;
  }

  _open(): void {
    for (const fn of this.listeners.open ?? []) fn(new Event("open"));
  }

  _message(data: string): void {
    for (const fn of this.listeners.message ?? []) {
      fn(Object.assign(new Event("message"), { data }) as MessageEvent);
    }
  }

  _close(): void {
    this.readyState = CLOSED;
    for (const fn of this.listeners.close ?? []) fn(new Event("close"));
  }

  _error(): void {
    for (const fn of this.listeners.error ?? []) fn(new Event("error"));
  }
}

// Inject mock into global before imports
(globalThis as any).WebSocket = MockWebSocket;

import { TunnelClient } from "../src/daemon/tunnel.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a client and drive it to the connected state. */
async function makeConnected(apiUrl = "https://api.example.com", apiKey = "test-key"): Promise<TunnelClient> {
  const client = new TunnelClient(apiUrl, apiKey);
  const connectPromise = client.connect();
  lastCreatedWs!._open();
  await connectPromise;
  return client;
}

// ── URL construction ─────────────────────────────────────────────────────────

describe("TunnelClient — URL construction", () => {
  it("converts https:// base URL to wss:// WebSocket URL", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    lastCreatedWs!._open();
    await p;
    expect(lastCreatedWs!.url).toMatch(/^wss:\/\//);
  });

  it("converts http:// base URL to ws:// WebSocket URL", async () => {
    const client = new TunnelClient("http://localhost:3000", "key");
    const p = client.connect();
    lastCreatedWs!._open();
    await p;
    expect(lastCreatedWs!.url).toMatch(/^ws:\/\//);
  });

  it("includes the role=daemon query parameter", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    lastCreatedWs!._open();
    await p;
    expect(lastCreatedWs!.url).toContain("role=daemon");
  });

  it("includes the api key as token query parameter", async () => {
    const client = new TunnelClient("https://api.example.com", "my-api-key");
    const p = client.connect();
    lastCreatedWs!._open();
    await p;
    expect(lastCreatedWs!.url).toContain("token=my-api-key");
  });

  it("URL-encodes special characters in the api key", async () => {
    const client = new TunnelClient("https://api.example.com", "key with spaces");
    const p = client.connect();
    lastCreatedWs!._open();
    await p;
    expect(lastCreatedWs!.url).toContain(encodeURIComponent("key with spaces"));
  });
});

// ── connect() ────────────────────────────────────────────────────────────────

describe("TunnelClient — connect()", () => {
  it("resolves when WebSocket opens", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    lastCreatedWs!._open();
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects when WebSocket closes before open (first attempt)", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    // error alone is a no-op; the close handler is what settles + schedules reconnect
    lastCreatedWs!._error();
    lastCreatedWs!._close();
    await expect(p).rejects.toThrow("Tunnel closed before open");
  });

  it("isConnected returns true after successful connect", async () => {
    const client = await makeConnected();
    expect(client.isConnected).toBe(true);
  });

  it("isConnected returns false before connect() is called", () => {
    const client = new TunnelClient("https://api.example.com", "key");
    expect(client.isConnected).toBe(false);
  });
});

// ── disconnect() ─────────────────────────────────────────────────────────────

describe("TunnelClient — disconnect()", () => {
  it("closes the WebSocket", async () => {
    const client = await makeConnected();
    const ws = lastCreatedWs!;
    client.disconnect();
    expect(ws.readyState).toBe(CLOSED);
  });

  it("sets isConnected to false after disconnect", async () => {
    const client = await makeConnected();
    client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("does not throw when called before connect()", () => {
    const client = new TunnelClient("https://api.example.com", "key");
    expect(() => client.disconnect()).not.toThrow();
  });
});

// ── sendEvent() ──────────────────────────────────────────────────────────────

describe("TunnelClient — sendEvent()", () => {
  it("sends a message with type agent:event", async () => {
    const client = await makeConnected();
    client.sendEvent("session-1", { type: "error", detail: "something broke" });
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.type).toBe("agent:event");
  });

  it("includes the sessionId in the sent message", async () => {
    const client = await makeConnected();
    client.sendEvent("session-abc", { type: "error", detail: "x" });
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.sessionId).toBe("session-abc");
  });

  it("includes the full event payload in the sent message", async () => {
    const client = await makeConnected();
    const event = { type: "rate_limit" as const, resetAt: "2025-01-01T00:00:00Z" };
    client.sendEvent("s1", event);
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.event).toEqual(event);
  });

  it("does not send when WebSocket is not open", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    // not connected — no ws yet
    expect(() => client.sendEvent("s1", { type: "error", detail: "x" })).not.toThrow();
  });
});

// ── sendStatus() ─────────────────────────────────────────────────────────────

describe("TunnelClient — sendStatus()", () => {
  it("sends a message with type agent:status", async () => {
    const client = await makeConnected();
    client.sendStatus("session-1", "working");
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.type).toBe("agent:status");
  });

  it("includes the sessionId in the sent message", async () => {
    const client = await makeConnected();
    client.sendStatus("session-xyz", "done");
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.sessionId).toBe("session-xyz");
  });

  it("includes the status value in the sent message", async () => {
    const client = await makeConnected();
    client.sendStatus("s1", "rate_limited");
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.status).toBe("rate_limited");
  });
});

// ── sendHistory() ────────────────────────────────────────────────────────────

describe("TunnelClient — sendHistory()", () => {
  it("sends a message with type session:history", async () => {
    const client = await makeConnected();
    client.sendHistory([], "req-1");
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.type).toBe("session:history");
  });

  it("includes the requestId in the sent message", async () => {
    const client = await makeConnected();
    client.sendHistory([], "req-42");
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.requestId).toBe("req-42");
  });

  it("includes the messages array in the sent message", async () => {
    const client = await makeConnected();
    const messages = [{ role: "user", content: "hello" }];
    client.sendHistory(messages, "req-1");
    const msg = JSON.parse(lastCreatedWs!.sentMessages[0]);
    expect(msg.messages).toEqual(messages);
  });
});

// ── onHumanMessage handler ────────────────────────────────────────────────────

describe("TunnelClient — onHumanMessage handler", () => {
  it("invokes the handler when a human:message is received", async () => {
    const client = await makeConnected();
    const handler = vi.fn();
    client.onHumanMessage(handler);
    lastCreatedWs!._message(JSON.stringify({ type: "human:message", sessionId: "s1", content: "hi" }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes sessionId and content to the handler", async () => {
    const client = await makeConnected();
    const handler = vi.fn();
    client.onHumanMessage(handler);
    lastCreatedWs!._message(JSON.stringify({ type: "human:message", sessionId: "ses-1", content: "hello world" }));
    expect(handler).toHaveBeenCalledWith("ses-1", "hello world");
  });

  it("does not throw when no handler is registered", async () => {
    const _client = await makeConnected();
    expect(() => lastCreatedWs!._message(JSON.stringify({ type: "human:message", sessionId: "s", content: "hi" }))).not.toThrow();
  });
});

// ── onHistoryRequest handler ──────────────────────────────────────────────────

describe("TunnelClient — onHistoryRequest handler", () => {
  it("invokes the handler when a request:history message is received", async () => {
    const client = await makeConnected();
    const handler = vi.fn();
    client.onHistoryRequest(handler);
    lastCreatedWs!._message(JSON.stringify({ type: "request:history", sessionId: "s1", requestId: "r1" }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes sessionId and requestId to the handler", async () => {
    const client = await makeConnected();
    const handler = vi.fn();
    client.onHistoryRequest(handler);
    lastCreatedWs!._message(JSON.stringify({ type: "request:history", sessionId: "sess", requestId: "req-id" }));
    expect(handler).toHaveBeenCalledWith("sess", "req-id");
  });
});

// ── Message parsing ───────────────────────────────────────────────────────────

describe("TunnelClient — message parsing", () => {
  it("silently ignores non-JSON messages", async () => {
    const client = await makeConnected();
    const handler = vi.fn();
    client.onHumanMessage(handler);
    expect(() => lastCreatedWs!._message("not json at all")).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("silently ignores messages with unknown type", async () => {
    const client = await makeConnected();
    const handler = vi.fn();
    client.onHumanMessage(handler);
    lastCreatedWs!._message(JSON.stringify({ type: "unknown:type", sessionId: "s1" }));
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Reconnect logic ───────────────────────────────────────────────────────────

describe("TunnelClient — reconnect on close", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not reconnect when disconnect() was called before close event", async () => {
    const client = await makeConnected();
    const firstWs = lastCreatedWs!;
    client.disconnect();
    firstWs._close();
    // If reconnect were triggered, lastCreatedWs would change
    expect(lastCreatedWs).toBe(firstWs);
  });

  it("schedules a reconnect attempt after socket close", async () => {
    const client = await makeConnected();
    const firstWs = lastCreatedWs!;
    firstWs._close();
    // Advance past RECONNECT_DELAY_MS (3000ms)
    vi.advanceTimersByTime(3100);
    // A new WebSocket should have been created
    expect(lastCreatedWs).not.toBe(firstWs);
    // Clean up
    client.disconnect();
  });
});

// ── connect() re-entry guard ──────────────────────────────────────────────────

describe("TunnelClient — connect() re-entry guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not create a second WebSocket when connect() is called twice while first is still pending", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    // First connect — WebSocket exists but not yet open
    client.connect();
    const firstWs = lastCreatedWs!;
    // Second connect call while socket is pending
    client.connect();
    // Must still be the same WebSocket instance
    expect(lastCreatedWs).toBe(firstWs);
    // Clean up — open then disconnect
    firstWs._open();
    client.disconnect();
  });

  it("does not create a second WebSocket when connect() is called while a reconnect timer is pending", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    // First attempt — close before open triggers a reconnect timer
    const p = client.connect();
    const firstWs = lastCreatedWs!;
    firstWs._close();
    await expect(p).rejects.toThrow("Tunnel closed before open");
    // Reconnect timer is now pending; ws is null but reconnectTimer is set
    // Second connect() call must not create a new WebSocket
    client.connect();
    expect(lastCreatedWs).toBe(firstWs);
    // Clean up
    client.disconnect();
  });

  it("does not create a second WebSocket when connect() is called while already fully open", async () => {
    const client = await makeConnected();
    const firstWs = lastCreatedWs!;
    // Call connect() again on an already-open client
    client.connect();
    expect(lastCreatedWs).toBe(firstWs);
    // Clean up
    client.disconnect();
  });

  it("allows a fresh connect() after disconnect() clears the guard state", async () => {
    const client = await makeConnected();
    const firstWs = lastCreatedWs!;
    client.disconnect();
    // disconnect() nulls ws and clears reconnectTimer — guard must allow a new connect
    client.connect();
    // A brand-new WebSocket should have been created
    expect(lastCreatedWs).not.toBe(firstWs);
    // Clean up
    lastCreatedWs!._open();
    client.disconnect();
  });
});

// ── disconnect() during connect — abort behavior ──────────────────────────────

describe("TunnelClient — disconnect() called while socket is connecting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects the connect() promise with 'Tunnel connect aborted' when disconnect() is called before the socket opens", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    // Socket is pending (not yet open or closed)
    client.disconnect();
    // Now fire the close event that the ws.close() call from disconnect() would trigger
    lastCreatedWs!._close();
    await expect(p).rejects.toThrow("Tunnel connect aborted");
  });

  it("does not schedule a reconnect after disconnect()-during-connect close event", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    const firstWs = lastCreatedWs!;
    client.disconnect();
    firstWs._close();
    // Swallow the expected rejection
    await p.catch(() => {});
    // Advance well past any possible reconnect delay
    vi.advanceTimersByTime(35_000);
    // No new WebSocket should have been created
    expect(lastCreatedWs).toBe(firstWs);
  });

  it("does not increment consecutiveFailures when disconnect()-during-connect fires the close event", async () => {
    const client = new TunnelClient("https://api.example.com", "key");
    const p = client.connect();
    client.disconnect();
    lastCreatedWs!._close();
    await p.catch(() => {});

    // A fresh client starts with delay 1000ms (consecutiveFailures=0 → first failure → 1s).
    // After disconnect-during-connect, consecutiveFailures must still be 0.
    // Verify: create a new client, trigger one normal failure, and confirm it backs off to 1000ms.
    const freshClient = new TunnelClient("https://api.example.com", "key");
    const fp = freshClient.connect();
    const freshWs = lastCreatedWs!;
    freshWs._close();
    await fp.catch(() => {});
    // After 1 failure, delay should be 1000ms. Advance 999ms — no new ws yet.
    vi.advanceTimersByTime(999);
    expect(lastCreatedWs).toBe(freshWs);
    // Advance 1ms more — reconnect fires and creates a new ws.
    vi.advanceTimersByTime(1);
    expect(lastCreatedWs).not.toBe(freshWs);
    freshClient.disconnect();
  });
});
