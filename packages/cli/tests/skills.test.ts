// @vitest-environment node
/**
 * Tests for ensureSkills in workspace/skills.ts — focused on:
 *   - silently skipping free-form capability labels (no '/' and no '@')
 *   - warning on entries that look like skill refs (contain '/' but no '@')
 *   - normal install path for valid source@skill entries
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks must be set up before importing the module under test ───────────────
const { warnMock, execSyncMock } = vi.hoisted(() => {
  return {
    warnMock: vi.fn(),
    execSyncMock: vi.fn((cmd: string, opts?: { cwd?: string }) => {
      lastExecSyncCall = { cmd, cwd: opts?.cwd ?? "" };
      return "";
    }),
  };
});

let lastExecSyncCall: { cmd: string; cwd: string } | null = null;

vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

import { ensureSkills } from "../src/workspace/skills.js";

const TEST_SKILL_DIR = join(tmpdir(), `ak-skills-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_SKILL_DIR, { recursive: true });
  lastExecSyncCall = null;
  warnMock.mockClear();
  execSyncMock.mockClear();
});

afterEach(() => {
  rmSync(TEST_SKILL_DIR, { recursive: true, force: true });
});

describe("ensureSkills — skill entry parsing", () => {
  it("warns when an entry contains '/' but no '@' (looks like a skill ref but is malformed)", () => {
    ensureSkills(TEST_SKILL_DIR, ["foo/bar"]);
    expect(warnMock).toHaveBeenCalledWith("Skipping invalid skill entry (missing @): foo/bar");
  });

  it("does NOT warn for free-form capability labels without '/' or '@'", () => {
    ensureSkills(TEST_SKILL_DIR, ["Full stack development"]);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("does NOT warn for free-form labels with spaces and hyphens", () => {
    ensureSkills(TEST_SKILL_DIR, ["React expert", "DevOps specialist"]);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("still installs a valid source@skill entry", () => {
    ensureSkills(TEST_SKILL_DIR, ["vercel-labs/agent-skills@react-best-practices"]);
    expect(lastExecSyncCall).not.toBeNull();
    expect(lastExecSyncCall!.cmd).toContain("npx skills add vercel-labs/agent-skills");
    expect(lastExecSyncCall!.cmd).toContain("--skill react-best-practices");
  });

  it("handles a mix of valid entries, malformed refs, and free-form labels", () => {
    ensureSkills(TEST_SKILL_DIR, [
      "vercel-labs/agent-skills@react-best-practices",
      "foo/bar", // malformed — should warn
      "Full stack development", // free-form — should not warn
    ]);

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith("Skipping invalid skill entry (missing @): foo/bar");
    expect(lastExecSyncCall).not.toBeNull();
  });
});
