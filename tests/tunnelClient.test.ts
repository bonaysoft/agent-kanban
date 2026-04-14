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

// ── Logger mock — shared instance so tests can spy on log calls ──────────────
// vi.mock factories are hoisted before variable declarations, so the shared
// logger instance must be created with vi.hoisted() to be in scope when the
// factory runs.

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => mockLogger,
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
  closeCallCount = 0;
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
    this.closeCallCount += 1;
    this.readyState = CLOSED;
    this._fire("close", { code: _code ?? 1000, reason: _reason ?? "" });
  }

  // ── Simulation helpers ────────────────────────────────────────────────────

  _simulateOpen(): void {
    this.readyState = OPEN;
    this._fire("open", {});
  }

  _simulateClose(code = 1006, reason = ""): void {
    this.readyState = CLOSED;
    this._fire("close", { code, reason });
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

import { TunnelClient } from "../packages/cli/src/daemon/tunnel.js";

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  createdSockets.length = 0;
  vi.useFakeTimers();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
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
    // Advance past the first reconnect attempt (1000ms base delay) then disconnect
    // to stop the infinite retry chain. runAllTimers is not usable here because
    // the retry loop is intentionally infinite.
    await vi.advanceTimersByTimeAsync(1100);
    client.disconnect();
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
    // First backoff is 1000ms — advance past it
    await vi.advanceTimersByTimeAsync(1100);
    expect(createdSockets.length).toBeGreaterThan(countBefore);
    client.disconnect();
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
    // First backoff is 1000ms — advance past it
    await vi.advanceTimersByTimeAsync(1100);
    expect(createdSockets.length).toBeGreaterThan(countAfterConnect);
    client.disconnect();
  });

  it("keeps retrying indefinitely — creates a new socket on each attempt", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    // Backoff sequence (ms): 1000, 2000, 4000. Advance enough for each.
    const delays = [1100, 2100, 4100];
    for (const delay of delays) {
      const sock = latestSocket();
      const prevCount = createdSockets.length;
      sock._simulateClose();
      await vi.advanceTimersByTimeAsync(delay);
      expect(createdSockets.length).toBeGreaterThan(prevCount);
    }
    client.disconnect();
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
    expect(Array.isArray(msg.events)).toBe(true);
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

// ── Single-close → single-reconnect (Bug B storm fix) ────────────────────────

describe("TunnelClient — single close yields exactly one reconnect attempt", () => {
  it("fires exactly one new WebSocket after a close event (not two)", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const firstSock = latestSocket();
    firstSock._simulateOpen();
    await connectPromise;

    const countAfterOpen = createdSockets.length;
    firstSock._simulateClose(1006);
    // Advance past the 1000ms first backoff
    await vi.advanceTimersByTimeAsync(1100);
    // Exactly one new socket, not two
    expect(createdSockets.length).toBe(countAfterOpen + 1);
    client.disconnect();
  });

  it("fires exactly one new WebSocket when close-before-open (not two)", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect().catch(() => {});
    const firstSock = latestSocket();
    firstSock._simulateClose(1006);
    await connectPromise;

    const countAfterClose = createdSockets.length;
    await vi.advanceTimersByTimeAsync(1100);
    expect(createdSockets.length).toBe(countAfterClose + 1);
    client.disconnect();
  });
});

// ── Exponential backoff sequence ──────────────────────────────────────────────

describe("TunnelClient — exponential backoff sequence", () => {
  it("delays follow 1s → 2s → 4s → 8s → 16s → 30s → 30s sequence", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    // Expected delays in ms for each consecutive failure
    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

    for (const delay of expectedDelays) {
      const prevCount = createdSockets.length;
      latestSocket()._simulateClose(1006);
      // Advance just under the expected delay — no new socket yet
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(createdSockets.length).toBe(prevCount);
      // Advance the remaining 1ms — new socket appears
      await vi.advanceTimersByTimeAsync(1);
      expect(createdSockets.length).toBe(prevCount + 1);
    }
    client.disconnect();
  });
});

// ── Backoff reset on successful open ─────────────────────────────────────────

describe("TunnelClient — backoff resets to 1s after a successful open", () => {
  it("next failure after a successful re-open uses 1000ms delay again", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    // Accumulate 3 failures (delays: 1s, 2s, 4s)
    latestSocket()._simulateClose(1006);
    await vi.advanceTimersByTimeAsync(1001);
    latestSocket()._simulateClose(1006);
    await vi.advanceTimersByTimeAsync(2001);
    latestSocket()._simulateClose(1006);
    await vi.advanceTimersByTimeAsync(4001);

    // Now fire open — this should reset consecutiveFailures to 0
    latestSocket()._simulateOpen();
    await vi.advanceTimersByTimeAsync(0); // flush microtasks

    // Next failure should use 1000ms, not 8000ms
    const prevCount = createdSockets.length;
    latestSocket()._simulateClose(1006);
    // Should NOT create a socket in the first 999ms
    await vi.advanceTimersByTimeAsync(999);
    expect(createdSockets.length).toBe(prevCount);
    // Should create one by 1001ms
    await vi.advanceTimersByTimeAsync(2);
    expect(createdSockets.length).toBe(prevCount + 1);
    client.disconnect();
  });
});

// ── Connect timeout / wedge detection (Bug A fix) ────────────────────────────

describe("TunnelClient — connect timeout breaks a wedged socket", () => {
  it("calls ws.close() when no event fires within 10000ms", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect().catch(() => {});
    const stalledSock = latestSocket();

    // Nothing fires — advance past the 10s connect timeout
    await vi.advanceTimersByTimeAsync(10_001);

    // The timeout should have called close() on the stalled socket
    expect(stalledSock.closeCallCount).toBeGreaterThanOrEqual(1);
    client.disconnect();
  });

  it("logs the stall warning when connect timeout fires", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect().catch(() => {});

    await vi.advanceTimersByTimeAsync(10_001);

    const warnCalls = mockLogger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnCalls.some((msg: string) => msg.includes("stalled"))).toBe(true);
    client.disconnect();
  });

  it("schedules a reconnect attempt after the forced close from timeout", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect().catch(() => {});
    const countBeforeTimeout = createdSockets.length;

    // Advance past connect timeout — forces close which triggers reconnect backoff
    await vi.advanceTimersByTimeAsync(10_001);
    // Advance past the first backoff (1000ms)
    await vi.advanceTimersByTimeAsync(1001);

    expect(createdSockets.length).toBeGreaterThan(countBeforeTimeout);
    client.disconnect();
  });
});

// ── Connect timeout cleared on normal open ────────────────────────────────────

describe("TunnelClient — connect timeout is cleared when open fires normally", () => {
  it("does not call ws.close() when open fires before the 10s timeout", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const sock = latestSocket();

    // Open fires within the window
    sock._simulateOpen();
    await connectPromise;

    // Advance well past 10s — timeout should have been cleared
    await vi.advanceTimersByTimeAsync(15_000);

    // closeCallCount should be 0 (no forced close from timeout)
    expect(sock.closeCallCount).toBe(0);
    client.disconnect();
  });
});

// ── Connect timeout cleared on normal close ───────────────────────────────────

describe("TunnelClient — connect timeout is cleared when close fires before timeout", () => {
  it("does not call ws.close() again after the socket already closed naturally", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect().catch(() => {});
    const sock = latestSocket();

    // Close fires before the 10s timeout
    sock._simulateClose(1006);

    // Advance past 10s — timeout should have been cleared by the close handler
    await vi.advanceTimersByTimeAsync(15_000);

    // The socket was already closed by _simulateClose (closeCallCount from that is 0
    // because _simulateClose doesn't call close() — it directly fires the event).
    // The important thing is the timeout path did NOT call ws.close() a second time.
    expect(sock.closeCallCount).toBe(0);
    client.disconnect();
  });
});

// ── disconnect() cancels pending reconnect ────────────────────────────────────

describe("TunnelClient.disconnect() — cancels pending reconnect timer", () => {
  it("does not create a new socket when disconnect() is called before the backoff elapses", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    const firstSock = latestSocket();
    firstSock._simulateOpen();
    await connectPromise;

    firstSock._simulateClose(1006);
    // The reconnect timer is now scheduled for 1000ms — disconnect before it fires
    client.disconnect();

    const countAtDisconnect = createdSockets.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(createdSockets.length).toBe(countAtDisconnect);
  });
});

// ── disconnect() cancels pending connect timeout ──────────────────────────────

describe("TunnelClient.disconnect() — cancels pending connect timeout", () => {
  it("does not call ws.close() from the timeout when disconnect() is called first", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect().catch(() => {});
    const stalledSock = latestSocket();

    // Disconnect before the 10s timeout fires
    client.disconnect();

    // Advance past 10s
    await vi.advanceTimersByTimeAsync(15_000);

    // The timeout was cleared — ws.close() should NOT have been called by the timeout
    expect(stalledSock.closeCallCount).toBe(1); // only from disconnect() itself
  });
});

// ── Max backoff cap ───────────────────────────────────────────────────────────

describe("TunnelClient — backoff is capped at 30000ms", () => {
  it("subsequent attempts after reaching cap are all 30000ms apart", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    // Burn through 6 failures to reach the 30s cap (1s,2s,4s,8s,16s,30s)
    const burnDelays = [1000, 2000, 4000, 8000, 16000, 30000];
    for (const delay of burnDelays) {
      latestSocket()._simulateClose(1006);
      await vi.advanceTimersByTimeAsync(delay + 1);
    }

    // Now at cap — each subsequent attempt should wait exactly 30000ms
    for (let i = 0; i < 3; i++) {
      const prevCount = createdSockets.length;
      latestSocket()._simulateClose(1006);
      // Should NOT fire at 29999ms
      await vi.advanceTimersByTimeAsync(29999);
      expect(createdSockets.length).toBe(prevCount);
      // Should fire at 30000ms
      await vi.advanceTimersByTimeAsync(1);
      expect(createdSockets.length).toBe(prevCount + 1);
    }
    client.disconnect();
  });
});

// ── WebSocket constructor throws ──────────────────────────────────────────────

describe("TunnelClient — WebSocket constructor throws", () => {
  it("rejects the connect() promise when the WebSocket constructor throws", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("boom");
        }
      },
    );

    const client = new TunnelClient("http://localhost:1234", "key");
    await expect(client.connect()).rejects.toThrow();

    // Restore the normal mock for subsequent tests
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("schedules a reconnect when the WebSocket constructor throws", async () => {
    let throwCount = 0;
    const ThrowingOnce = class extends FakeWebSocket {
      constructor(url: string) {
        if (throwCount === 0) {
          throwCount++;
          throw new Error("constructor boom");
        }
        super(url);
      }
    };
    vi.stubGlobal("WebSocket", ThrowingOnce);

    const client = new TunnelClient("http://localhost:1234", "key");
    client.connect().catch(() => {});

    const countAfterThrow = createdSockets.length; // 0 — constructor threw
    // Advance past first backoff (1000ms)
    await vi.advanceTimersByTimeAsync(1100);
    expect(createdSockets.length).toBeGreaterThan(countAfterThrow);

    vi.stubGlobal("WebSocket", FakeWebSocket);
    client.disconnect();
  });
});

// ── Log message format ────────────────────────────────────────────────────────

describe("TunnelClient — reconnect log message format", () => {
  it("logs the correct format with delay and attempt number on first failure", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    latestSocket()._simulateClose(1006);

    const warnCalls = mockLogger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnCalls.some((msg: string) => msg.includes("reconnecting in 1000ms (attempt 1)"))).toBe(true);
    client.disconnect();
  });

  it("increments the attempt counter on each consecutive failure", async () => {
    const client = new TunnelClient("http://localhost:1234", "key");
    const connectPromise = client.connect();
    latestSocket()._simulateOpen();
    await connectPromise;

    // First failure
    latestSocket()._simulateClose(1006);
    await vi.advanceTimersByTimeAsync(1001);
    // Second failure on the new socket
    latestSocket()._simulateClose(1006);

    const warnCalls = mockLogger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnCalls.some((msg: string) => msg.includes("attempt 2"))).toBe(true);
    client.disconnect();
  });
});
