// @vitest-environment node
/**
 * Tests for runtime.ts — detectRuntime() and findRuntimeAncestorPid().
 *
 * findRuntimeAncestorPid() calls execFileSync("ps", ...) internally via the
 * private readProcess() helper. We mock node:child_process to control what
 * process ancestry looks like without spawning real `ps` processes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock child_process before any imports touch it ────────────────────────────
const mockExecFileSync = vi.fn<[string, string[], object], string>();

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

// Import after mocks are registered
const { detectRuntime, findRuntimeAncestorPid } = await import("../src/runtime.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a fake `ps -o ppid=,command=` output line. */
function psLine(ppid: number, command: string): string {
  return `  ${ppid}  ${command}`;
}

// ── Environment cleanup ───────────────────────────────────────────────────────

function clearRuntimeEnv() {
  delete process.env.CLAUDECODE;
  delete process.env.CODEX_CI;
  delete process.env.GEMINI_CLI;
}

beforeEach(() => {
  clearRuntimeEnv();
  vi.clearAllMocks();
});

afterEach(() => {
  clearRuntimeEnv();
});

// ── detectRuntime ─────────────────────────────────────────────────────────────

describe("detectRuntime", () => {
  it("returns null when no runtime env vars are set", () => {
    expect(detectRuntime()).toBeNull();
  });

  it("returns 'claude' when CLAUDECODE is set", () => {
    process.env.CLAUDECODE = "1";
    expect(detectRuntime()).toBe("claude");
  });

  it("returns 'codex' when CODEX_CI is set", () => {
    process.env.CODEX_CI = "1";
    expect(detectRuntime()).toBe("codex");
  });

  it("returns 'gemini' when GEMINI_CLI is set", () => {
    process.env.GEMINI_CLI = "1";
    expect(detectRuntime()).toBe("gemini");
  });

  it("prioritises CLAUDECODE over CODEX_CI when both are set", () => {
    process.env.CLAUDECODE = "1";
    process.env.CODEX_CI = "1";
    // Object.entries order follows insertion order of RUNTIME_ENV constant
    expect(detectRuntime()).toBe("claude");
  });
});

// ── findRuntimeAncestorPid — null / error cases ───────────────────────────────

describe("findRuntimeAncestorPid — null / error cases", () => {
  it("returns null for an unknown runtime name", () => {
    expect(findRuntimeAncestorPid("unknown-runtime")).toBeNull();
  });

  it("returns null when ps exits with an error on the first pid", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("ps: no such process");
    });
    expect(findRuntimeAncestorPid("claude")).toBeNull();
  });

  it("returns null when ps returns an empty string", () => {
    mockExecFileSync.mockReturnValue("   ");
    expect(findRuntimeAncestorPid("claude")).toBeNull();
  });

  it("returns null when ps output does not match expected format", () => {
    mockExecFileSync.mockReturnValue("garbage that does not parse");
    expect(findRuntimeAncestorPid("claude")).toBeNull();
  });

  it("returns null when ancestry chain reaches pid 1 without a match", () => {
    // Simulate a chain: ppid → 2 → 1 (init), no claude in sight.
    // When the queried pid is 1 (init), the loop stops because pid <= 1.
    let callCount = 0;
    mockExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return psLine(2, "/bin/bash");
      return psLine(1, "/sbin/init");
    });
    expect(findRuntimeAncestorPid("claude")).toBeNull();
  });
});

// ── findRuntimeAncestorPid — happy paths ─────────────────────────────────────

describe("findRuntimeAncestorPid — happy paths", () => {
  it("returns the pid of a direct parent whose command is 'claude'", () => {
    // process.ppid is the first pid queried. We stub it to report command=claude.
    const claudePid = process.ppid;
    mockExecFileSync.mockReturnValueOnce(psLine(1, "/usr/local/bin/claude"));
    const result = findRuntimeAncestorPid("claude");
    expect(result).toBe(claudePid);
  });

  it("returns the pid of a grandparent whose command matches claude", () => {
    // Chain: process.ppid=100 → ppid=200 (claude)
    // First call: pid=process.ppid → {ppid:200, command:"/bin/bash"}
    // Second call: pid=200 → {ppid:1, command:"/usr/bin/claude"}
    mockExecFileSync.mockReturnValueOnce(psLine(200, "/bin/bash")).mockReturnValueOnce(psLine(1, "/usr/bin/claude"));

    const result = findRuntimeAncestorPid("claude");
    expect(result).toBe(200);
  });

  it("matches 'codex' runtime against codex command", () => {
    mockExecFileSync.mockReturnValueOnce(psLine(1, "/usr/local/bin/codex"));
    expect(findRuntimeAncestorPid("codex")).toBe(process.ppid);
  });

  it("matches 'gemini' runtime against gemini command", () => {
    mockExecFileSync.mockReturnValueOnce(psLine(1, "/usr/local/bin/gemini"));
    expect(findRuntimeAncestorPid("gemini")).toBe(process.ppid);
  });

  it("matches a command that has arguments after the runtime name", () => {
    // e.g. "claude --dangerously-skip-permissions"
    mockExecFileSync.mockReturnValueOnce(psLine(1, "/usr/local/bin/claude --dangerously-skip-permissions"));
    expect(findRuntimeAncestorPid("claude")).toBe(process.ppid);
  });

  it("does not match a command where runtime name is a substring of another word", () => {
    // e.g. "not-claude" should NOT match "claude" pattern
    mockExecFileSync.mockReturnValueOnce(psLine(2, "not-claude")).mockReturnValueOnce(psLine(1, "/sbin/init"));
    expect(findRuntimeAncestorPid("claude")).toBeNull();
  });
});

// ── findRuntimeAncestorPid — hard cap ────────────────────────────────────────

describe("findRuntimeAncestorPid — 32-hop hard cap", () => {
  it("stops after 32 hops and returns null when no match found", () => {
    // Build a deep chain of 40 hops, each pointing to the next pid
    // None of them have a claude command
    let pid = 10000;
    mockExecFileSync.mockImplementation(() => {
      pid++;
      return psLine(pid, "/bin/sh");
    });

    const result = findRuntimeAncestorPid("claude");
    expect(result).toBeNull();
    // Should have called ps at most 32 times (the hard cap)
    expect(mockExecFileSync).toHaveBeenCalledTimes(32);
  });
});
