// @vitest-environment node
/**
 * Tests for ProcessManager — focused on:
 *   - sendToSession() return value
 *   - tunnel.sendEvent() forwarding for all event types
 *   - tunnel.sendStatus("working") called on spawn
 *   - tunnel.sendStatus("done") called on cleanup
 */

import { describe, expect, it, type Mock, vi } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── sessionStore mock ─────────────────────────────────────────────────────────
vi.mock("../src/sessionStore.js", () => ({
  removeSession: vi.fn(),
  updateSession: vi.fn(),
  readSession: vi.fn().mockReturnValue(null),
}));

// ── systemPrompt mock ─────────────────────────────────────────────────────────
vi.mock("../src/systemPrompt.js", () => ({
  cleanupPromptFile: vi.fn(),
}));

import type { AgentClient, ApiClient } from "../src/client.js";
import { ProcessManager, type SpawnRequest } from "../src/processManager.js";
import type { AgentEvent, AgentHandle, AgentProvider } from "../src/providers/types.js";
import { readSession, removeSession } from "../src/sessionStore.js";
import type { TunnelClient } from "../src/tunnelClient.js";

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
    pid: null,
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
    onProcessStarted: vi.fn(),
    onProcessExited: vi.fn(),
  };
}

// ── Helper: wait for all microtasks / promises to settle ──────────────────────
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── sendToSession() ────────────────────────────────────────────────────────────

describe("ProcessManager.sendToSession()", () => {
  it("returns false when no agent matches the given sessionId", async () => {
    const pm = new ProcessManager(makeApiClient(), makeCallbacks());
    const result = await pm.sendToSession("nonexistent", "hello");
    expect(result).toBe(false);
  });

  it("returns true when an agent with the matching sessionId exists", async () => {
    const tunnel = makeTunnel();
    // Use a never-resolving handle so the agent stays in the map
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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const provider = makeProvider(neverHandle);
    const agentClient = makeAgentClient("agent-1", "session-abc");
    const apiClient = makeApiClient();
    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);

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
    // Clean up the hanging generator
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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const provider = makeProvider(neverHandle);
    const agentClient = makeAgentClient("agent-1", "session-xyz");
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);

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

    // Should not throw
    await expect(
      pm.spawnAgent({
        provider,
        taskId: "task-1",
        sessionId: "sess-1",
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
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) });
    const callbacks = makeCallbacks();
    const onCleanup = vi.fn();
    const pm = new ProcessManager(apiClient, callbacks, 0, tunnel);

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

    // Wait for event loop to finish
    await flushPromises();
    await flushPromises();

    expect(tunnel.sendStatus).toHaveBeenCalledWith("sess-done", "done");
  });
});

// ── tunnel.sendEvent() for all event types ────────────────────────────────────

describe("ProcessManager — tunnel.sendEvent() forwarding", () => {
  async function spawnWithEvents(events: AgentEvent[], tunnel: TunnelClient): Promise<void> {
    const handle = makeHandle(events);
    const provider = makeProvider(handle);
    const agentClient = makeAgentClient("a1", "sess-ev");
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) });
    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);

    await pm.spawnAgent({
      provider,
      taskId: "task-ev",
      sessionId: "sess-ev",
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
    const event: AgentEvent = { type: "assistant", blocks: [{ type: "text", text: "hello" }] };
    await spawnWithEvents([event], tunnel);
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev", event);
  });

  it("forwards rate_limit event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "rate_limit", status: "rejected", resetAt: "2025-01-01T00:00:00Z" };
    await spawnWithEvents([event], tunnel);
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev", event);
  });

  it("forwards error event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "error", detail: "something broke" };
    await spawnWithEvents([event], tunnel);
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev", event);
  });

  it("forwards result event to tunnel", async () => {
    const tunnel = makeTunnel();
    const event: AgentEvent = { type: "result", cost: 0.0012 };
    await spawnWithEvents([event], tunnel);
    expect(tunnel.sendEvent).toHaveBeenCalledWith("sess-ev", event);
  });

  it("does not throw when tunnel is not provided and events arrive", async () => {
    const handle = makeHandle([{ type: "error", detail: "x" }]);
    const provider = makeProvider(handle);
    const pm = new ProcessManager(makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) }), makeCallbacks(), 0);

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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-active" }));

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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-xyz" }));

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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-msg" }));

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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(neverHandle), taskId: "task-kill" }));

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
      pid: null,
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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const pm = new ProcessManager(makeApiClient(), makeCallbacks(), 0);
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handleA), taskId: "task-a" }));
    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handleB), taskId: "task-b", sessionId: "session-b" }));

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

    await pm.spawnAgent(makeSpawnRequest({ provider: failingProvider, taskId: "task-fail" }));

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
      pid: null,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const apiClient = makeApiClient();
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(apiClient, callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(throwingHandle), taskId: "task-crash" }));

    await flushPromises();
    await flushPromises();

    expect(apiClient.releaseTask).toHaveBeenCalledWith("task-crash");
    expect(callbacks.onSlotFreed).toHaveBeenCalled();
  });
});

// ── onProcessStarted callback ─────────────────────────────────────────────────

describe("ProcessManager — onProcessStarted callback", () => {
  it("fires onProcessStarted when the handle has a pid", async () => {
    let resolveAbort!: () => void;
    const handleWithPid: AgentHandle = {
      events: (async function* () {
        await new Promise<void>((r) => {
          resolveAbort = r;
        });
      })(),
      abort: vi.fn().mockImplementation(() => {
        resolveAbort?.();
        return Promise.resolve();
      }),
      pid: 9999,
      send: vi.fn().mockResolvedValue(undefined),
    };
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handleWithPid), sessionId: "sess-pid" }));

    resolveAbort?.();
    expect(callbacks.onProcessStarted).toHaveBeenCalledWith("sess-pid", 9999);
  });
});

// ── handleEvent — rate_limit branching ───────────────────────────────────────

describe("ProcessManager — handleEvent rate_limit rejected", () => {
  it("calls onRateLimited when a rejected rate_limit event is received", async () => {
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const event: AgentEvent = { type: "rate_limit", status: "rejected", resetAt };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).toHaveBeenCalledWith("claude", resetAt);
  });

  it("does not call onRateLimitResumed when a rejected rate_limit event is received", async () => {
    const event: AgentEvent = { type: "rate_limit", status: "rejected", resetAt: new Date(Date.now() + 3600_000).toISOString() };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-no-resume" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).not.toHaveBeenCalled();
  });

  it("uses overage resetAt as pauseUntil when both main and overage are rejected and overage is later", async () => {
    const mainResetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const overageResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const event: AgentEvent = {
      type: "rate_limit",
      status: "rejected",
      resetAt: mainResetAt,
      overage: { status: "rejected", resetAt: overageResetAt },
    };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-overage" }));
    await flushPromises();
    await flushPromises();

    // overage is later, so onRateLimited should be called with the overage resetAt
    expect(callbacks.onRateLimited).toHaveBeenCalledWith("claude", overageResetAt);
  });

  it("uses main resetAt when main is later than overage", async () => {
    const mainResetAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const overageResetAt = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
    const event: AgentEvent = {
      type: "rate_limit",
      status: "rejected",
      resetAt: mainResetAt,
      overage: { status: "rejected", resetAt: overageResetAt },
    };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-main-later" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).toHaveBeenCalledWith("claude", mainResetAt);
  });

  it("falls back to 1-hour pauseUntil when rejected event has no resetAt", async () => {
    const before = Date.now();
    const event: AgentEvent = { type: "rate_limit", status: "rejected" };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-no-reset" }));
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
    const event: AgentEvent = { type: "rate_limit", status: "allowed", isUsingOverage: false };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-cleared" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).toHaveBeenCalledWith("claude");
  });

  it("does not call onRateLimitResumed when allowed event with isUsingOverage true", async () => {
    const event: AgentEvent = { type: "rate_limit", status: "allowed", isUsingOverage: true };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-overage-running" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimitResumed).not.toHaveBeenCalled();
  });

  it("does not call onRateLimited when allowed event is received", async () => {
    const event: AgentEvent = { type: "rate_limit", status: "allowed", isUsingOverage: false };
    const handle = makeHandle([event]);
    const callbacks = makeCallbacks();
    const pm = new ProcessManager(makeApiClient(), callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-rl-allowed-no-limited" }));
    await flushPromises();
    await flushPromises();

    expect(callbacks.onRateLimited).not.toHaveBeenCalled();
  });
});

describe("ProcessManager — result event does not call onRateLimitResumed", () => {
  it("does not call onRateLimitResumed when a result event is received after a rejected rate_limit", async () => {
    const rejectedEvent: AgentEvent = {
      type: "rate_limit",
      status: "rejected",
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const resultEvent: AgentEvent = { type: "result", cost: 0.001 };
    const handle = makeHandle([rejectedEvent, resultEvent]);
    const callbacks = makeCallbacks();
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_progress" }) });
    const pm = new ProcessManager(apiClient, callbacks, 0);

    await pm.spawnAgent(makeSpawnRequest({ provider: makeProvider(handle), taskId: "task-result-no-resume" }));
    await flushPromises();
    await flushPromises();

    // result event alone must NOT clear the rate limit
    expect(callbacks.onRateLimitResumed).not.toHaveBeenCalled();
    // but onRateLimited was called for the rejected event
    expect(callbacks.onRateLimited).toHaveBeenCalledOnce();
  });
});

// ── Fix 2: onComplete — in_review branch skips safeCleanup ───────────────────

describe("ProcessManager — onComplete skips cleanup when session is in_review", () => {
  it("does NOT invoke onCleanup when the local session status is in_review", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "result", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const onCleanup = vi.fn();
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_review" }) });

    // Make readSession return a session with status in_review
    vi.mocked(readSession).mockReturnValue({ status: "in_review" } as any);

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
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

  it("sends tunnel done status when the local session status is in_review", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "result", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_review" }) });

    vi.mocked(readSession).mockReturnValue({ status: "in_review" } as any);

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
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

  it("does NOT call removeSession when the local session status is in_review", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "result", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "in_review" }) });

    vi.mocked(readSession).mockReturnValue({ status: "in_review" } as any);
    vi.mocked(removeSession).mockClear();

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
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

    expect(removeSession).not.toHaveBeenCalled();
  });
});

describe("ProcessManager — onComplete normal completion invokes cleanup", () => {
  it("invokes onCleanup when session is NOT in_review (normal completion)", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "result", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const onCleanup = vi.fn();
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "done" }) });

    // Local session is active (not in_review)
    vi.mocked(readSession).mockReturnValue({ status: "active" } as any);

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
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

  it("calls removeSession when session is NOT in_review (normal completion)", async () => {
    const tunnel = makeTunnel();
    const resultEvent: AgentEvent = { type: "result", cost: 0.001 };
    const handle = makeHandle([resultEvent]);
    const apiClient = makeApiClient({ getTask: vi.fn().mockResolvedValue({ status: "done" }) });

    vi.mocked(readSession).mockReturnValue({ status: "active" } as any);
    vi.mocked(removeSession).mockClear();

    const pm = new ProcessManager(apiClient, makeCallbacks(), 0, tunnel);
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

    expect(removeSession).toHaveBeenCalledWith("sess-normal-remove");
  });
});
