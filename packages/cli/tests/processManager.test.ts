// @vitest-environment node
/**
 * Tests for ProcessManager — focused on:
 *   - sendToSession() return value
 *   - tunnel.sendEvent() forwarding for all event types
 *   - tunnel.sendStatus("working") called on spawn
 *   - tunnel.sendStatus("done") called on cleanup
 *   - onCleanup invocation based on session state machine outcome
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// ── Redirect SESSIONS_DIR to a temp path BEFORE importing session code ────────
const { tmpRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  return { tmpRoot: mkdtempSync(join(tmpdir(), "ak-pm-test-")) };
});

vi.mock("../src/paths.js", async (importOriginal) => {
  const mod = (await importOriginal()) as any;
  const { join } = await import("node:path");
  return {
    ...mod,
    SESSIONS_DIR: join(tmpRoot, "sessions"),
  };
});

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── systemPrompt mock ─────────────────────────────────────────────────────────
vi.mock("../src/agent/systemPrompt.js", () => ({
  cleanupPromptFile: vi.fn(),
}));

import type { AgentClient, ApiClient } from "../src/client/index.js";
import { ProcessManager, type SpawnRequest } from "../src/daemon/processManager.js";
import { SessionManager } from "../src/session/manager.js";
import { readSession, writeSession } from "../src/session/store.js";
import type { SessionFile } from "../src/session/types.js";
import type { TunnelClient } from "../src/daemon/tunnel.js";
import type { AgentEvent, AgentHandle, AgentProvider } from "../src/providers/types.js";

// ── Session helpers ───────────────────────────────────────────────────────────

let sm: SessionManager;

function makeWorkerSession(sessionId: string, overrides: Partial<SessionFile> = {}): SessionFile {
  return {
    type: "worker",
    agentId: "agent-1",
    sessionId,
    runtime: "claude" as any,
    startedAt: Date.now(),
    apiUrl: "http://localhost",
    privateKeyJwk: { kty: "OKP" } as JsonWebKey,
    taskId: "task-1",
    workspace: { type: "temp", cwd: "/tmp/x" },
    status: "active",
    ...overrides,
  };
}

// ── Minimal fakes ─────────────────────────────────────────────────────────────

function makeTunnel(): TunnelClient & { sendEvent: Mock; sendStatus: Mock } {
  return {
    sendEvent: vi.fn(),
    sendStatus: vi.fn(),
    sendHistory: vi.fn(),
    onHumanMessage: vi.fn(),
    onHistoryRequest: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: true,
  } as unknown as TunnelClient & { sendEvent: Mock; sendStatus: Mock };
}

function makeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getTask: vi.fn().mockResolvedValue({ status: "in_progress" }),
    releaseTask: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ApiClient;
}

function makeAgentClient(agentId = "agent-1", sessionId = "session-1"): AgentClient {
  return {
    getAgentId: () => agentId,
    getSessionId: () => sessionId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    updateSessionUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentClient;
}

function makeHandle(events: AgentEvent[] = [], opts: Partial<AgentHandle> = {}): AgentHandle {
  return {
    events: (async function* () {
      for (const e of events) yield e;
    })(),
    abort: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    ...opts,
  };
}

function makeProvider(handle: AgentHandle): AgentProvider {
  return {
    name: "claude" as any,
    label: "Claude",
    execute: vi.fn().mockResolvedValue(handle),
  };
}

function makeSpawnRequest(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  const handle = makeHandle();
  return {
    provider: makeProvider(handle),
    taskId: "task-1",
    sessionId: "session-1",
    cwd: "/tmp",
    taskContext: "do the thing",
    agentClient: makeAgentClient(),
    agentEnv: {},
    ...overrides,
  };
}

function makeCallbacks() {
  return {
    onSlotFreed: vi.fn(),
    onRateLimited: vi.fn(),
    onRateLimitResumed: vi.fn(),
  };
}

// ── Helper: wait for all microtasks / promises to settle ──────────────────────
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  sm = new SessionManager();
  sm._resetForTest();
});

afterEach(() => {
  rmSync(join(tmpRoot, "sessions"), { recursive: true, force: true });
});

// ── sendToSession() ────────────────────────────────────────────────────────────

describe("ProcessManager.sendToSession()", () => {
  it("returns false when no agent matches the given sessionId", async () => {
    const pm = new ProcessManager(makeApiClient(), makeCallbacks());
    const result = await pm.sendToSession("nonexistent", "hello");
    expect(result).toBe(false);
  });

  it("returns true when an agent with the matching sessionId exists", async () => {
    const tunnel = makeTunnel();
    let resolveAbort!: () => void;
    const neverHandle: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const provider = makeProvider(neverHandle);
    const agentClient = makeAgentClient("agent-1", "session-abc");
    const apiClient = makeApiClient();
    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);

    writeSession(makeWorkerSession("session-abc", { taskId: "task-1" }));

    await pm.spawnAgent({
      provider,
      taskId: "task-1",
      sessionId: "session-abc",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient,
      agentEnv: {},
    });

    const result = await pm.sendToSession("session-abc", "hello");
    resolveAbort?.();
    expect(result).toBe(true);
  });

  it("calls handle.send with the message when sessionId matches", async () => {
    let resolveAbort!: () => void;
    const neverHandle: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const provider = makeProvider(neverHandle);
    const agentClient = makeAgentClient("agent-1", "session-xyz");
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

    writeSession(makeWorkerSession("session-xyz", { taskId: "task-2" }));

    await pm.spawnAgent({
      provider,
      taskId: "task-2",
      sessionId: "session-xyz",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient,
      agentEnv: {},
    });

    await pm.sendToSession("session-xyz", "my message");
    resolveAbort?.();
    expect(neverHandle.send).toHaveBeenCalledWith("my message");
  });
});

// ── tunnel.sendStatus("working") on spawn ─────────────────────────────────────

describe("ProcessManager — tunnel.sendStatus on spawn", () => {
  it("calls tunnel.sendStatus with working after agent is spawned", async () => {
    const tunnel = makeTunnel();
    const handle = makeHandle();
    const provider = makeProvider(handle);
    const agentClient = makeAgentClient("a1", "sess-1");
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0, tunnel);

    writeSession(makeWorkerSession("sess-1", { taskId: "task-1" }));

    await pm.spawnAgent({
      provider,
      taskId: "task-1",
      sessionId: "sess-1",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient,
      agentEnv: {},
    });

    expect(tunnel.sendStatus).toHaveBeenCalledWith("sess-1", "working");
  });

  it("does not call tunnel.sendStatus when no tunnel is provided", async () => {
    const handle = makeHandle();
    const provider = makeProvider(handle);
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-notunnel", { taskId: "task-notunnel" }));

    await expect(
      pm.spawnAgent({
        provider,
        taskId: "task-notunnel",
        sessionId: "sess-notunnel",
        cwd: "/tmp",
        taskContext: "ctx",
        agentClient: makeAgentClient(),
        agentEnv: {},
      }),
    ).resolves.toBeUndefined();
  });
});

// ── tunnel.sendStatus("done") on cleanup ─────────────────────────────────────

describe("ProcessManager — tunnel.sendStatus on cleanup", () => {
  it("calls tunnel.sendStatus with done when agent finishes and cleanup runs", async () => {
    const tunnel = makeTunnel();
    const handle = makeHandle([]); // empty events — completes immediately
    const provider = makeProvider(handle);
    const agentClient = makeAgentClient("a1", "sess-done");
    // getTask returns "cancelled" so taskInReview=false → completing path → runCleanup
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) });
    const callbacks = makeCallbacks();
    const onCleanup = vi.fn();
    const pm = new ProcessManager(apiClient, callbacks, 0, tunnel);

    writeSession(makeWorkerSession("sess-done", { taskId: "task-cleanup" }));

    await pm.spawnAgent({
      provider,
      taskId: "task-cleanup",
      sessionId: "sess-done",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient,
      agentEnv: {},
      onCleanup,
    });

    await flushPromises();
    await flushPromises();

    expect(tunnel.sendStatus).toHaveBeenCalledWith("sess-done", "done");
  });
});

// ── tunnel.sendEvent() for all event types ────────────────────────────────────

describe("ProcessManager — tunnel.sendEvent() forwarding", () => {
  async function spawnWithEvents(events: AgentEvent[], tunnel: TunnelClient, sessionId = "sess-ev", taskId = "task-ev"): Promise<void> {
    const handle = makeHandle(events);
    const provider = makeProvider(handle);
    const agentClient = makeAgentClient("a1", sessionId);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) });
    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);

    writeSession(makeWorkerSession(sessionId, { taskId }));

    await pm.spawnAgent({
      provider,
      taskId,
      sessionId,
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient,
      agentEnv: {},
    });

    await flushPromises();
    await flushPromises();
  }

  it("forwards assistant event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "message", blocks: [{ type: "text", text: "hello" }] };
    await spawnWithEvents([event], tunnel, "sess-ev-1", "task-ev-1");
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev-1", event);
  });

  it("forwards rate_limit event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "turn.rate_limit", status: "rejected", resetAt: "2025-01-01T00:00:00Z" };
    await spawnWithEvents([event], tunnel, "sess-ev-2", "task-ev-2");
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev-2", event);
  });

  it("forwards error event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "error", detail: "something broke" };
    await spawnWithEvents([event], tunnel, "sess-ev-3", "task-ev-3");
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev-3", event);
  });

  it("forwards result event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "turn.end", cost: 0.0012 };
    await spawnWithEvents([event], tunnel, "sess-ev-4", "task-ev-4");
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev-4", event);
  });

  it("does not throw when tunnel is not provided and events arrive", async () => {
    const handle = makeHandle([{ type: "error", detail: "x" }]);
    const provider = makeProvider(handle);
    const pm = new ProcessManager(makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) }), makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-no-tunnel", { taskId: "task-no-tunnel" }));

    await expect(
      pm.spawnAgent({
        provider,
        taskId: "task-no-tunnel",
        sessionId: "sess-no-tunnel",
        cwd: "/tmp",
        taskContext: "ctx",
        agentClient: makeAgentClient(),
        agentEnv: {},
      }),
    ).resolves.toBeUndefined();

    await flushPromises();
    await flushPromises();
  });
});

// ── activeCount / hasTask / getActiveTaskIds ──────────────────────────────────

describe("ProcessManager — activeCount / hasTask / getActiveTaskIds", () => {
  it("activeCount returns 0 when no agents are running", () => {
    const pm = new ProcessManager(makeApiClient(), makeCallbacks());
    expect(pm.activeCount).toBe(0);
  });

  it("hasTask returns false when task is not running", () => {
    const pm = new ProcessManager(makeApiClient(), makeCallbacks());
    expect(pm.hasTask("nonexistent")).toBe(false);
  });

  it("activeCount and hasTask reflect a running agent", async () => {
    let resolveAbort!: () => void;
    const neverHandle: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-active", { taskId: "task-active" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-active", sessionId: "sess-active" }));

    expect(pm.activeCount).toBe(1);
    expect(pm.hasTask("task-active")).toBe(true);
    resolveAbort?.();
  });

  it("getActiveTaskIds returns ids of all running agents", async () => {
    let resolveAbort!: () => void;
    const neverHandle: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-xyz", { taskId: "task-xyz" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-xyz", sessionId: "sess-xyz" }));

    expect(pm.getActiveTaskIds()).toContain("task-xyz");
    resolveAbort?.();
  });
});

// ── sendToAgent() ─────────────────────────────────────────────────────────────

describe("ProcessManager — sendToAgent()", () => {
  it("does nothing when the taskId does not exist", async () => {
    const pm = new ProcessManager(makeApiClient(), makeCallbacks());
    await expect(pm.sendToAgent("nonexistent", "msg")).resolves.toBeUndefined();
  });

  it("delivers the message to the matching task's handle", async () => {
    let resolveAbort!: () => void;
    const neverHandle: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-msg", { taskId: "task-msg" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-msg", sessionId: "sess-msg" }));

    await pm.sendToAgent("task-msg", "hello task");
    resolveAbort?.();
    expect(neverHandle.send).toHaveBeenCalledWith("hello task");
  });
});

// ── killTask() ────────────────────────────────────────────────────────────────

describe("ProcessManager — killTask()", () => {
  it("does nothing when the task does not exist", async () => {
    const pm = new ProcessManager(makeApiClient(), makeCallbacks());
    await expect(pm.killTask("nonexistent")).resolves.toBeUndefined();
  });

  it("aborts the handle and frees the slot", async () => {
    let resolveAbort!: () => void;
    const neverHandle: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-kill", { taskId: "task-kill" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-kill", sessionId: "sess-kill" }));

    await pm.killTask("task-kill");

    expect(neverHandle.abort).toHaveBeenCalled();
    expect(pm.hasTask("task-kill")).toBe(false);
    expect(callbacks.onSlotFreed).toHaveBeenCalled();
  });
});

// ── killAll() ─────────────────────────────────────────────────────────────────

describe("ProcessManager — killAll()", () => {
  it("kills all running agents and frees slots", async () => {
    let resolveA!: () => void;
    let resolveB!: () => void;
    const handleA: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveA = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveA?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const handleB: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveB = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveB?.();
        return Promise.resolve();
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-a", { taskId: "task-a" }));
    writeSession(makeWorkerSession("sess-b", { taskId: "task-b" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handleA), taskId: "task-a", sessionId: "sess-a" }));
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handleB), taskId: "task-b", sessionId: "sess-b" }));

    await pm.killAll();

    expect(handleA.abort).toHaveBeenCalled();
    expect(handleB.abort).toHaveBeenCalled();
    expect(pm.activeCount).toBe(0);
  });
});

// ── spawnAgent — provider execute failure ─────────────────────────────────────

describe("ProcessManager — spawnAgent provider failure", () => {
  it("releases the task when provider.execute() throws", async () => {
    const apiClient = makeApiClient();
    const failingProvider: AgentProvider = {
      name: "claude" as any,
      label: "Claude",
      execute: vi.fn().mockRejectedValue(new Error("provider exploded")),
    };
    const pm = new ProcessManager(apiClient, makeCallbacks(), 0);

    writeSession(makeWorkerSession("sess-fail", { taskId: "task-fail" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: failingProvider, taskId: "task-fail", sessionId: "sess-fail" }));

    expect(apiClient.releaseTask).toHaveBeenCalledWith("task-fail");
    expect(pm.hasTask("task-fail")).toBe(false);
  });
});

// ── onCrash path ──────────────────────────────────────────────────────────────

describe("ProcessManager — crash path", () => {
  it("releases the task when the event iterator throws", async () => {
    const throwingHandle: AgentHandle = {
      // biome-ignore lint/correctness/useYield: generator must throw without yielding to test crash path
      events: (async function* () {
        throw Object.assign(new Error("process crashed"), { exitCode: 1, stderr: "oom" });
      })(),
      abort: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const apiClient = makeApiClient();
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(apiClient, callbacks, 0);

    writeSession(makeWorkerSession("sess-crash", { taskId: "task-crash" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(throwingHandle), taskId: "task-crash", sessionId: "sess-crash" }));

    await flushPromises();
    await flushPromises();

    expect(apiClient.releaseTask).toHaveBeenCalledWith("task-crash");
    expect(callbacks.onSlotFreed).toHaveBeenCalled();
  });
});

// ── handleEvent — rate_limit branching ───────────────────────────────────────

describe("ProcessManager — handleEvent rate_limit rejected", () => {
  it("calls onRateLimited when a rejected rate_limit event is received", async () => {
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const event: AgentEvent = { type: "turn.rate_limit", status: "rejected", resetAt };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl", { taskId: "task-rl" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl", sessionId: "sess-rl" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).toHaveBeenCalledWith("claude", resetAt);
  });

  it("does not call onRateLimitResumed when a rejected rate_limit event is received", async () => {
    const event: AgentEvent = { type: "turn.rate_limit", status: "rejected", resetAt: new Date(Date.now() + 3600_000).toISOString() };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-noresume", { taskId: "task-rl-no-resume" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-no-resume", sessionId: "sess-rl-noresume" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).not.toHaveBeenCalled();
  });

  it("uses overage resetAt as pauseUntil when both main and overage are rejected and overage is later", async () => {
    const mainResetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const overageResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const event: AgentEvent = {
      type: "turn.rate_limit",
      status: "rejected",
      resetAt: mainResetAt,
      overage: { status: "rejected", resetAt: overageResetAt },
    };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-overage", { taskId: "task-rl-overage" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-overage", sessionId: "sess-rl-overage" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).toHaveBeenCalledWith("claude", overageResetAt);
  });

  it("uses main resetAt when main is later than overage", async () => {
    const mainResetAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const overageResetAt = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
    const event: AgentEvent = {
      type: "turn.rate_limit",
      status: "rejected",
      resetAt: mainResetAt,
      overage: { status: "rejected", resetAt: overageResetAt },
    };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-main-later", { taskId: "task-rl-main-later" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-main-later", sessionId: "sess-rl-main-later" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).toHaveBeenCalledWith("claude", mainResetAt);
  });

  it("falls back to 1-hour pauseUntil when rejected event has no resetAt", async () => {
    const before = Date.now();
    const event: AgentEvent = { type: "turn.rate_limit", status: "rejected" };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-noreset", { taskId: "task-rl-no-reset" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-no-reset", sessionId: "sess-rl-noreset" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).toHaveBeenCalledOnce();
    const pauseUntil = callbacks.onRateLimited.mock.calls[0][1] as string;
    const pauseMs = new Date(pauseUntil).getTime();
    expect(pauseMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
  });
});

describe("ProcessManager — handleEvent rate_limit allowed", () => {
  it("calls onRateLimitResumed when allowed event with isUsingOverage false", async () => {
    const event: AgentEvent = { type: "turn.rate_limit", status: "allowed", isUsingOverage: false };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-cleared", { taskId: "task-rl-cleared" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-cleared", sessionId: "sess-rl-cleared" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).toHaveBeenCalledWith("claude");
  });

  it("does not call onRateLimitResumed when allowed event with isUsingOverage true", async () => {
    const event: AgentEvent = { type: "turn.rate_limit", status: "allowed", isUsingOverage: true };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-overage-running", { taskId: "task-rl-overage-running" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-overage-running", sessionId: "sess-rl-overage-running" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).not.toHaveBeenCalled();
  });

  it("does not call onRateLimited when allowed event is received", async () => {
    const event: AgentEvent = { type: "turn.rate_limit", status: "allowed", isUsingOverage: false };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    writeSession(makeWorkerSession("sess-rl-allowed", { taskId: "task-rl-allowed-no-limited" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-allowed-no-limited", sessionId: "sess-rl-allowed" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).not.toHaveBeenCalled();
  });
});

describe("ProcessManager — result event does not call onRateLimitResumed", () => {
  it("does not call onRateLimitResumed when a result event is received after a rejected rate_limit", async () => {
    const rejectedEvent: AgentEvent = {
      type: "turn.rate_limit",
      status: "rejected",
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const resultEvent: AgentEvent = { type: "turn.end", cost: 0.001 };
    const handle = makeHandle([rejectedEvent, resultEvent]);
    const callbacks = makeCallbacks();
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_progress" }) });
    const pm = new ProcessManager(apiClient, callbacks, 0);

    writeSession(makeWorkerSession("sess-result-no-resume", { taskId: "task-result-no-resume" }));

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-result-no-resume", sessionId: "sess-result-no-resume" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).not.toHaveBeenCalled();
    expect(callbacks.onRateLimited).toHaveBeenCalledOnce();
  });
});

// ── Fix 2: onComplete — in_review branch skips safeCleanup ───────────────────
// The state machine drives the decision: getTask returning "in_review" causes
// taskInReview=true which routes the state machine to in_review (not completing).
// runCleanup is only called on the "completing" branch.

describe("ProcessManager — onComplete skips cleanup when session is in_review", () => {
  it("does NOT invoke onCleanup when getTask returns in_review", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "turn.end", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const onCleanup = vi.fn();
    // getTask returns in_review → taskInReview=true → state machine → in_review
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_review" }) });

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
    writeSession(makeWorkerSession("sess-review", { taskId: "task-review" }));

    await pm.spawnAgent({
      provider: makeProvider(handle),
      taskId: "task-review",
      sessionId: "sess-review",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient: makeAgentClient("a1", "sess-review"),
      agentEnv: {},
      onCleanup,
    });

    await flushPromises();
    await flushPromises();

    expect(onCleanup).not.toHaveBeenCalled();
  });

  it("sends tunnel done status when getTask returns in_review", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "turn.end", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_review" }) });

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
    writeSession(makeWorkerSession("sess-review-done", { taskId: "task-review-done" }));

    await pm.spawnAgent({
      provider: makeProvider(handle),
      taskId: "task-review-done",
      sessionId: "sess-review-done",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient: makeAgentClient("a1", "sess-review-done"),
      agentEnv: {},
    });

    await flushPromises();
    await flushPromises();

    expect(tunnel.sendStatus).toHaveBeenCalledWith("sess-review-done", "done");
  });

  it("does NOT remove the session file when getTask returns in_review", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "turn.end", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_review" }) });

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
    writeSession(makeWorkerSession("sess-review-no-remove", { taskId: "task-review-no-remove" }));

    await pm.spawnAgent({
      provider: makeProvider(handle),
      taskId: "task-review-no-remove",
      sessionId: "sess-review-no-remove",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient: makeAgentClient("a1", "sess-review-no-remove"),
      agentEnv: {},
    });

    await flushPromises();
    await flushPromises();

    // Session file must still exist on disk (state machine landed on in_review, not terminal)
    expect(readSession("sess-review-no-remove")).not.toBeNull();
  });
});

describe("ProcessManager — onComplete normal completion invokes cleanup", () => {
  it("invokes onCleanup when getTask returns done (normal completion)", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "turn.end", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const onCleanup = vi.fn();
    // getTask returns "done" → taskInReview=false → state machine → completing → runCleanup
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "done" }) });

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
    writeSession(makeWorkerSession("sess-normal", { taskId: "task-normal" }));

    await pm.spawnAgent({
      provider: makeProvider(handle),
      taskId: "task-normal",
      sessionId: "sess-normal",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient: makeAgentClient("a1", "sess-normal"),
      agentEnv: {},
      onCleanup,
    });

    await flushPromises();
    await flushPromises();

    expect(onCleanup).toHaveBeenCalled();
  });

  it("removes session file when getTask returns done (normal completion)", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "turn.end", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "done" }) });

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
    writeSession(makeWorkerSession("sess-normal-remove", { taskId: "task-normal-remove" }));

    await pm.spawnAgent({
      provider: makeProvider(handle),
      taskId: "task-normal-remove",
      sessionId: "sess-normal-remove",
      cwd: "/tmp",
      taskContext: "ctx",
      agentClient: makeAgentClient("a1", "sess-normal-remove"),
      agentEnv: {},
    });

    await flushPromises();
    await flushPromises();

    // After cleanup_done the state machine removes the file
    expect(readSession("sess-normal-remove")).toBeNull();
  });
});
