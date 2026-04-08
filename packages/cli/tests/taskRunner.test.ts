// @vitest-environment node
/**
 * Tests for TaskRunner — focused on Fix 5:
 *   resumeSession() bails out cleanly when workspace.cwd does not exist,
 *   calling removeSession + releaseTask and returning false.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
  writeSession: vi.fn(),
  updateSession: vi.fn(),
}));

// ── config mock ───────────────────────────────────────────────────────────────
vi.mock("../src/config.js", () => ({
  getCredentials: vi.fn().mockReturnValue({ apiUrl: "https://example.com" }),
}));

// ── providers/registry mock ───────────────────────────────────────────────────
vi.mock("../src/providers/registry.js", () => ({
  getProvider: vi.fn().mockReturnValue({
    name: "claude",
    label: "Claude Code",
    execute: vi.fn(),
  }),
  normalizeRuntime: vi.fn().mockImplementation((r: string) => r),
}));

// ── systemPrompt mock ─────────────────────────────────────────────────────────
vi.mock("../src/systemPrompt.js", () => ({
  generateSystemPrompt: vi.fn().mockResolvedValue("system prompt"),
  writePromptFile: vi.fn().mockReturnValue("/tmp/prompt.txt"),
  cleanupPromptFile: vi.fn(),
}));

// ── skillManager mock ─────────────────────────────────────────────────────────
vi.mock("../src/skillManager.js", () => ({
  ensureSkills: vi.fn().mockResolvedValue(undefined),
}));

// ── processManager mock ───────────────────────────────────────────────────────
const mockSpawnAgent = vi.fn().mockResolvedValue(undefined);
const mockProcessManager = { spawnAgent: mockSpawnAgent } as any;

// ── AgentClient mock ──────────────────────────────────────────────────────────
vi.mock("../src/client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/client.js")>("../src/client.js");
  return {
    ...actual,
    AgentClient: vi.fn().mockImplementation(() => ({
      getAgentId: () => "agent-mock",
      getSessionId: () => "session-mock",
      sendMessage: vi.fn(),
      updateSessionUsage: vi.fn(),
    })),
  };
});

import type { MachineClient } from "../src/client.js";
import type { SessionFile } from "../src/sessionStore.js";
import { removeSession } from "../src/sessionStore.js";
import { TaskRunner } from "../src/taskRunner.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMachineClient(overrides: Partial<MachineClient> = {}): MachineClient {
  return {
    releaseTask: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue({ status: "in_review" }),
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    closeSession: vi.fn().mockResolvedValue(undefined),
    updateSessionUsage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MachineClient;
}

function makeSession(cwdOverride: string, overrides: Partial<SessionFile> = {}): SessionFile {
  return {
    type: "worker",
    agentId: randomUUID(),
    sessionId: randomUUID(),
    pid: process.pid,
    runtime: "claude" as any,
    startedAt: Date.now(),
    apiUrl: "https://example.com",
    privateKeyJwk: { kty: "OKP", crv: "Ed25519", x: "abc", d: "def" },
    taskId: randomUUID(),
    status: "in_review",
    workspace: { type: "temp", cwd: cwdOverride },
    ...overrides,
  };
}

// ── Fix 5: resumeSession() cwd guard ─────────────────────────────────────────

describe("TaskRunner.resumeSession — missing workspace.cwd", () => {
  it("returns false when workspace.cwd does not exist", async () => {
    const missingCwd = join(tmpdir(), `ak-nonexistent-${randomUUID()}`);
    const session = makeSession(missingCwd);
    const client = makeMachineClient();
    const runner = new TaskRunner(client, mockProcessManager);

    const result = await runner.resumeSession(session, "retry after rejection");

    expect(result).toBe(false);
  });

  it("calls removeSession with the session ID when workspace.cwd is missing", async () => {
    const missingCwd = join(tmpdir(), `ak-nonexistent-${randomUUID()}`);
    const session = makeSession(missingCwd);
    const client = makeMachineClient();
    const runner = new TaskRunner(client, mockProcessManager);
    vi.mocked(removeSession).mockClear();

    await runner.resumeSession(session, "retry");

    expect(vi.mocked(removeSession)).toHaveBeenCalledWith(session.sessionId);
  });

  it("calls client.releaseTask with the task ID when workspace.cwd is missing", async () => {
    const missingCwd = join(tmpdir(), `ak-nonexistent-${randomUUID()}`);
    const session = makeSession(missingCwd);
    const client = makeMachineClient();
    const runner = new TaskRunner(client, mockProcessManager);

    await runner.resumeSession(session, "retry");

    expect(client.releaseTask).toHaveBeenCalledWith(session.taskId);
  });

  it("does NOT call spawnAgent when workspace.cwd is missing", async () => {
    const missingCwd = join(tmpdir(), `ak-nonexistent-${randomUUID()}`);
    const session = makeSession(missingCwd);
    const client = makeMachineClient();
    const runner = new TaskRunner(client, mockProcessManager);
    mockSpawnAgent.mockClear();

    await runner.resumeSession(session, "retry");

    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });
});

describe("TaskRunner.resumeSession — existing workspace.cwd proceeds past the guard", () => {
  it("does not return false immediately when workspace.cwd exists", async () => {
    // Create a real temp dir so existsSync returns true
    const existingCwd = mkdtempSync(join(tmpdir(), "ak-existing-"));
    try {
      const session = makeSession(existingCwd);
      // Let getTask return a cancelled task so the function bails early but
      // for a different reason (task gone), not the cwd guard.
      const client = makeMachineClient({ getTask: vi.fn().mockResolvedValue({ status: "cancelled" }) });
      const runner = new TaskRunner(client, mockProcessManager);

      const result = await runner.resumeSession(session, "retry");

      // The function returns false for a cancelled task, but the cwd guard
      // was NOT the reason — spawnAgent was not called, which proves we got
      // past the guard into the task status check.
      expect(result).toBe(false);
      expect(client.getTask).toHaveBeenCalledWith(session.taskId);
    } finally {
      try {
        rmdirSync(existingCwd);
      } catch {
        /* ignore */
      }
    }
  });
});
