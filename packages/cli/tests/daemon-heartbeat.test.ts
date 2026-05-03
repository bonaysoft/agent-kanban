// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  registerMachine: vi.fn(),
  capturedRateLimitSink: null as null | { onRateLimited: (runtime: string, resetAt: string) => void; onRateLimitResumed: (runtime: string) => void },
  availability: null as null | Record<string, { status: "ready" | "unauthorized"; detail?: string }>,
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../src/client/index.js", () => ({
  MachineClient: vi.fn().mockImplementation(() => ({
    registerMachine: mocks.registerMachine,
    heartbeat: mocks.heartbeat,
  })),
}));

vi.mock("../src/config.js", () => ({
  getCredentials: () => ({ apiUrl: "https://example.test", apiKey: "ak_test" }),
}));

vi.mock("../src/device.js", () => ({
  generateDeviceId: () => "device-test",
}));

vi.mock("../src/version.js", () => ({
  getVersion: () => "1.2.3",
}));

vi.mock("../src/providers/registry.js", () => ({
  getAvailableProviders: () => [
    {
      name: "claude",
      label: "Claude",
      checkAvailability: () => mocks.availability?.claude ?? { status: "ready" },
      execute: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
    },
    {
      name: "codex",
      label: "Codex",
      checkAvailability: () => mocks.availability?.codex ?? { status: "ready" },
      execute: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
    },
  ],
  getProvider: () => ({ getHistory: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("../src/session/manager.js", () => ({
  getSessionManager: () => ({ read: vi.fn().mockReturnValue(null) }),
}));

vi.mock("../src/session/store.js", () => ({
  migrateLegacySessions: vi.fn(),
}));

vi.mock("../src/daemon/cleanup.js", () => ({
  auditOrphanedTasks: vi.fn().mockResolvedValue(undefined),
  cleanupLeaderSessions: vi.fn().mockResolvedValue(undefined),
  cleanupStaleSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/daemon/loop.js", () => ({
  DaemonLoop: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    onSlotFreed: vi.fn(),
    resumeRateLimitedSessions: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/daemon/prMonitor.js", () => ({
  PrMonitor: vi.fn().mockImplementation(() => ({ start: vi.fn(), stop: vi.fn(), track: vi.fn() })),
}));

vi.mock("../src/daemon/runtimePool.js", () => ({
  RuntimePool: vi.fn().mockImplementation((_client, _callbacks, rateLimitSink) => {
    mocks.capturedRateLimitSink = rateLimitSink;
    return { killAll: vi.fn().mockResolvedValue(undefined), sendToSession: vi.fn().mockResolvedValue(false) };
  }),
}));

vi.mock("../src/daemon/tunnel.js", () => ({
  TunnelClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    onHistoryRequest: vi.fn(),
    onHumanMessage: vi.fn(),
    sendHistory: vi.fn(),
  })),
}));

vi.mock("../src/daemon/usageCollector.js", () => ({
  UsageCollector: vi.fn().mockImplementation(() => ({ start: vi.fn(), stop: vi.fn(), getSnapshot: vi.fn().mockReturnValue(null) })),
}));

import { startDaemon } from "../src/daemon/index.js";

describe("daemon heartbeat runtime states", () => {
  let listeners: Partial<Record<NodeJS.Signals | "unhandledRejection", Array<(...args: never[]) => unknown>>>;

  beforeEach(() => {
    listeners = {
      SIGINT: process.listeners("SIGINT"),
      SIGTERM: process.listeners("SIGTERM"),
      unhandledRejection: process.listeners("unhandledRejection"),
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-21T10:00:00.000Z"));
    mocks.heartbeat.mockReset();
    mocks.registerMachine.mockReset();
    mocks.registerMachine.mockResolvedValue({ id: "machine-1" });
    mocks.capturedRateLimitSink = null;
    mocks.availability = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const event of ["SIGINT", "SIGTERM", "unhandledRejection"] as const) {
      process.removeAllListeners(event);
      for (const listener of listeners[event] ?? []) process.on(event, listener as any);
    }
  });

  it("reports ready runtimes, then reports a rate-limited runtime with reset_at", async () => {
    await startDaemon({ maxConcurrent: 1, pollInterval: 5000 });

    expect(mocks.registerMachine).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: "device-test",
        runtimes: [
          { name: "claude", status: "ready", checked_at: "2026-03-21T10:00:00.000Z" },
          { name: "codex", status: "ready", checked_at: "2026-03-21T10:00:00.000Z" },
        ],
      }),
    );
    expect(mocks.heartbeat).toHaveBeenCalledWith("machine-1", {
      version: "1.2.3",
      runtimes: [
        { name: "claude", status: "ready", checked_at: "2026-03-21T10:00:00.000Z" },
        { name: "codex", status: "ready", checked_at: "2026-03-21T10:00:00.000Z" },
      ],
    });

    const resetAt = "2026-03-21T10:30:00.000Z";
    mocks.capturedRateLimitSink!.onRateLimited("claude", resetAt);
    await Promise.resolve();

    expect(mocks.heartbeat).toHaveBeenLastCalledWith("machine-1", {
      version: "1.2.3",
      usage_info: null,
      runtimes: [
        {
          name: "claude",
          status: "limited",
          detail: "runtime paused by rate limiter",
          reset_at: resetAt,
          checked_at: "2026-03-21T10:00:00.000Z",
        },
        { name: "codex", status: "ready", checked_at: "2026-03-21T10:00:00.000Z" },
      ],
    });
  });

  it("reports unauthorized runtimes from provider availability checks", async () => {
    mocks.availability = {
      claude: { status: "unauthorized", detail: "Claude Code is not logged in" },
      codex: { status: "ready" },
    };

    await startDaemon({ maxConcurrent: 1, pollInterval: 5000 });

    expect(mocks.registerMachine).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimes: [
          {
            name: "claude",
            status: "unauthorized",
            detail: "Claude Code is not logged in",
            checked_at: "2026-03-21T10:00:00.000Z",
          },
          { name: "codex", status: "ready", checked_at: "2026-03-21T10:00:00.000Z" },
        ],
      }),
    );
  });
});
