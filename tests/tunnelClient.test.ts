// @vitest-environment node
/**
 * Unit tests for TunnelClient.
 *
 * WebSocket is mocked globally. A tiny FakeWebSocket class provides
 * addEventListener, send, close, readyState, and simulation helpers.
 * All instances are tracked so tests can grab "the latest socket" after
 * a reconnect attempt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Logger mock — suppress all output ────────────────────────────────────────

vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── FakeWebSocket ─────────────────────────────────────────────────────────────

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const createdSockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;

  readyState: number = CONNECTING;
  url: string;
  sentMessages: string[] = [];
  private _listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    createdSockets.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = CLOSED;
    this._fire("close", {});
  }

  // ── Simulation helpers ────────────────────────────────────────────────────

  _simulateOpen(): void {
    this.readyState = OPEN;
    this._fire("open", {});
  }

  _simulateClose(): void {
    this.readyState = CLOSED;
    this._fire("close", {});
  }

  _simulateError(): void {
    this._fire("error", { type: "error" });
  }

  _simulateMessage(data: unknown): void {
    this._fire("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  private _fire(type: string, event: unknown): void {
    for (const fn of this._listeners[type] ?? []) {
      fn(event);
    }
  }
}

function latestSocket(): FakeWebSocket {
  return createdSockets[createdSockets.length - 1];
}

// ── Module under test ─────────────────────────────────────────────────────────

// Import after the mock is in place so the module picks up FakeWebSocket.
vi.stubGlobal("WebSocket", FakeWebSocket);

import { TunnelClient } from "../packages/cli/src/tunnelClient.js";

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  createdSockets.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});

// ── connect() — happy path ────────────────────────────────────────────────────

describe("TunnelClient.connect() — happy path", () => {
  it("resolves when the WebSocket fires open", async () => {
    const client = new TunnelClient("http://localhost:1234", "key-abc");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await expect(connectPromise).resolves.toBeUndefined();
  });

  it("marks isConnected as true after open", async () => {
    const client = new TunnelClient("http://localhost:1234", "key-abc");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;
    expect(client.isConnected).toBe(true);
  });

  it("uses wss:// when apiUrl is https://", async () => {
    const client = new TunnelClient("https://relay.example.com", "key-abc");
    client.connect();
    expect(latestSocket().url).toMatch(/^wss:\/\//);
  });

  it("uses ws:// when apiUrl is http://", async () => {
    const client = new TunnelClient("http://relay.example.com", "key-abc");
    client.connect();
    expect(latestSocket().url).toMatch(/^ws:\/\//);
  });

  it("includes the api key as a query param", async () => {
    const client = new TunnelClient("http://localhost:1234", "my-secret-key");
    client.connect();
    expect(latestSocket().url).toContain("token=my-secret-key");
  });

  it("includes role=daemon in the URL", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect();
    expect(latestSocket().url).toContain("role=daemon");
  });
});

// ── connect() — error/close before open ──────────────────────────────────────

describe("TunnelClient.connect() — error and close before open", () => {
  it("rejects when the WS closes before firing open", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    // Simulate error then close (no open)
    latestSocket()._simulateError();
    latestSocket()._simulateClose();
    // Promise must settle — not hang
    await expect(connectPromise).rejects.toThrow();
  });

  it("promise settles in finite time (does not hang)", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    let settled = false;
    const connectPromise = client.connect().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    latestSocket()._simulateError();
    latestSocket()._simulateClose();
    // Advance timers so any pending reconnect timeouts fire
    await vi.runAllTimersAsync();
    await connectPromise;
    expect(settled).toBe(true);
  });

  it("schedules a reconnect after the socket closes before open", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect().catch(() => {});
    const firstSocket = latestSocket();
    firstSocket._simulateError();
    firstSocket._simulateClose();
    await connectPromise;

    const countBefore = createdSockets.length;
    // Advance past the RECONNECT_DELAY_MS (2000 ms)
    await vi.advanceTimersByTimeAsync(2100);
    expect(createdSockets.length).toBeGreaterThan(countBefore);
  });
});

// ── Reconnect after successful connection closes ───────────────────────────────

describe("TunnelClient — automatic reconnect after successful connection drops", () => {
  it("schedules another openSocket when the WS closes after open", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const firstSocket = latestSocket();
    firstSocket._simulateOpen();
    await connectPromise;

    const countAfterConnect = createdSockets.length;
    firstSocket._simulateClose(); // simulate unexpected drop
    await vi.advanceTimersByTimeAsync(2100);
    expect(createdSockets.length).toBeGreaterThan(countAfterConnect);
  });

  it("keeps retrying indefinitely — creates a new socket on each attempt", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    // Simulate 3 sequential drops
    for (let i = 0; i < 3; i++) {
      const sock = latestSocket();
      const prevCount = createdSockets.length;
      sock._simulateClose();
      await vi.advanceTimersByTimeAsync(2100);
      expect(createdSockets.length).toBeGreaterThan(prevCount);
    }
  });
});

// ── disconnect() stops reconnect and sets closed flag ─────────────────────────

describe("TunnelClient.disconnect()", () => {
  it("prevents reconnect after disconnect() is called", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    client.disconnect();
    const countAtDisconnect = createdSockets.length;

    // Simulate close event arriving after disconnect
    latestSocket()._simulateClose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(createdSockets.length).toBe(countAtDisconnect);
  });

  it("sets isConnected to false after disconnect()", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;
    client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("stops the keepalive timer — no more pings sent after disconnect", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const sock = latestSocket();
    sock._simulateOpen();
    await connectPromise;

    client.disconnect();
    sock.sentMessages = [];

    // Advance well past the 25s keepalive interval
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sock.sentMessages).toHaveLength(0);
  });
});

// ── Keepalive ping ────────────────────────────────────────────────────────────

describe("TunnelClient — keepalive ping", () => {
  it("sends a {type:ping} message after 25s", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const sock = latestSocket();
    sock._simulateOpen();
    await connectPromise;

    sock.sentMessages = [];
    await vi.advanceTimersByTimeAsync(25_000);

    expect(sock.sentMessages.length).toBeGreaterThanOrEqual(1);
    const ping = JSON.parse(sock.sentMessages[0]);
    expect(ping.type).toBe("ping");
  });

  it("does not send a ping before 25s have elapsed", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const sock = latestSocket();
    sock._simulateOpen();
    await connectPromise;

    sock.sentMessages = [];
    await vi.advanceTimersByTimeAsync(24_999);
    expect(sock.sentMessages).toHaveLength(0);
  });

  it("sends pings on every subsequent 25s interval", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const sock = latestSocket();
    sock._simulateOpen();
    await connectPromise;

    sock.sentMessages = [];
    await vi.advanceTimersByTimeAsync(75_000); // 3 intervals
    const pings = sock.sentMessages.filter((m) => JSON.parse(m).type === "ping");
    expect(pings.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Incoming message dispatch ─────────────────────────────────────────────────

describe("TunnelClient — incoming message dispatch", () => {
  async function connectAndGetSocket(client: TunnelClient): Promise<FakeWebSocket> {
    const p = client.connect();
    const sock = latestSocket();
    sock._simulateOpen();
    await p;
    return sock;
  }

  it("dispatches human:message to the registered handler", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const sock = await connectAndGetSocket(client);

    const received: Array<{ sessionId: string; content: string }> = [];
    client.onHumanMessage((sessionId, content) => received.push({ sessionId, content }));

    sock._simulateMessage({ type: "human:message", sessionId: "sess-1", content: "hello" });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ sessionId: "sess-1", content: "hello" });
  });

  it("dispatches request:history to the registered handler", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const sock = await connectAndGetSocket(client);

    const received: Array<{ sessionId: string; requestId: string }> = [];
    client.onHistoryRequest((sessionId, requestId) => received.push({ sessionId, requestId }));

    sock._simulateMessage({ type: "request:history", sessionId: "sess-2", requestId: "req-42" });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ sessionId: "sess-2", requestId: "req-42" });
  });

  it("does not throw on unknown message types", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const sock = await connectAndGetSocket(client);
    expect(() => sock._simulateMessage({ type: "unknown:thing" })).not.toThrow();
  });

  it("does not throw on non-JSON message data", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const sock = await connectAndGetSocket(client);
    expect(() => sock._simulateMessage("not-json")).not.toThrow();
  });
});

// ── sendEvent / sendStatus / sendHistory ─────────────────────────────────────

describe("TunnelClient — send methods", () => {
  async function openClient(): Promise<{ client: TunnelClient; sock: FakeWebSocket }> {
    const client = new TunnelClient("http://localhost:1234", "key");
    const p = client.connect();
    const sock = latestSocket();
    sock._simulateOpen();
    await p;
    sock.sentMessages = [];
    return { client, sock };
  }

  it("sendEvent sends a message with type agent:event when OPEN", async () => {
    const { client, sock } = await openClient();
    client.sendEvent("sess-1", { type: "assistant", blocks: [] });
    expect(sock.sentMessages).toHaveLength(1);
    const msg = JSON.parse(sock.sentMessages[0]);
    expect(msg.type).toBe("agent:event");
    expect(msg.sessionId).toBe("sess-1");
  });

  it("sendEvent includes the event payload", async () => {
    const { client, sock } = await openClient();
    const event = { type: "assistant" as const, blocks: [{ type: "text" as const, text: "hi" }] };
    client.sendEvent("s1", event);
    const msg = JSON.parse(sock.sentMessages[0]);
    expect(msg.event).toEqual(event);
  });

  it("sendStatus sends a message with type agent:status", async () => {
    const { client, sock } = await openClient();
    client.sendStatus("sess-2", "working");
    const msg = JSON.parse(sock.sentMessages[0]);
    expect(msg.type).toBe("agent:status");
    expect(msg.sessionId).toBe("sess-2");
    expect(msg.status).toBe("working");
  });

  it("sendHistory sends a message with type session:history and requestId", async () => {
    const { client, sock } = await openClient();
    client.sendHistory([{ role: "user", content: "hey" }], "req-99");
    const msg = JSON.parse(sock.sentMessages[0]);
    expect(msg.type).toBe("session:history");
    expect(msg.requestId).toBe("req-99");
    expect(Array.isArray(msg.messages)).toBe(true);
  });

  it("sendEvent does not send when socket is not OPEN", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    // Never open the socket
    client.connect();
    const sock = latestSocket(); // still CONNECTING
    client.sendEvent("sess-1", { type: "assistant", blocks: [] });
    expect(sock.sentMessages).toHaveLength(0);
  });

  it("sendStatus does not send when socket is not OPEN", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect();
    const sock = latestSocket();
    client.sendStatus("sess-1", "done");
    expect(sock.sentMessages).toHaveLength(0);
  });

  it("sendHistory does not send when socket is not OPEN", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect();
    const sock = latestSocket();
    client.sendHistory([], "req-1");
    expect(sock.sentMessages).toHaveLength(0);
  });
});
