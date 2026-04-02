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
}));

// ── systemPrompt mock ─────────────────────────────────────────────────────────
vi.mock("../src/systemPrompt.js", () => ({
  cleanupPromptFile: vi.fn(),
}));

import type { AgentClient, ApiClient } from "../src/client.js";
import { ProcessManager, type SpawnRequest } from "../src/processManager.js";
import type { AgentEvent, AgentHandle, AgentProvider } from "../src/providers/types.js";
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
    onRateLimitCleared: vi.fn(),
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
    const event: AgentEvent = { type: "rate_limit", resetAt: "2025-01-01T00:00:00Z" };
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
