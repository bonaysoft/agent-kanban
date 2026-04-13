// @vitest-environment node

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentInfo } from "../packages/cli/src/agent/systemPrompt.js";
import { cleanupPromptFile, generateSystemPrompt, writePromptFile } from "../packages/cli/src/agent/systemPrompt.js";

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "agent-1",
    name: "TestAgent",
    role: "developer",
    soul: null,
    handoff_to: null,
    skills: null,
    runtime: "claude-cli",
    model: null,
    ...overrides,
  };
}

// ─── DEV lifecycle ─────────────────────────────────────────────────────────

describe("generateSystemPrompt — dev board", () => {
  it("uses ak create note --task for progress logging", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toContain("ak create note --task");
  });

  it("does NOT contain ak task log anywhere", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).not.toContain("ak task log");
  });

  it("contains ak wait pr in the dev lifecycle", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toContain("ak wait pr");
  });

  it("dev lifecycle has a PR step (gh pr create)", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toContain("gh pr create");
  });

  it("dev lifecycle has a Wait for CI step", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toContain("Wait for CI");
  });

  it("dev lifecycle has 5 numbered steps", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    // Steps 1–5 must all appear in the lifecycle constant
    for (let i = 1; i <= 5; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });

  it("dev lifecycle does NOT have a 6th numbered lifecycle step", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    // The lifecycle constant ends at step 5 — step 6 is not a lifecycle step
    expect(prompt).not.toMatch(/^6\.\s+\*\*/m);
  });

  it("includes agent identity with correct id", () => {
    const prompt = generateSystemPrompt(makeAgent({ id: "agent-42" }), "dev");
    expect(prompt).toContain("https://agent-kanban.dev/agents/agent-42");
  });

  it("includes agent name", () => {
    const prompt = generateSystemPrompt(makeAgent({ name: "Coder" }), "dev");
    expect(prompt).toContain("Name: Coder");
  });

  it("includes agent role", () => {
    const prompt = generateSystemPrompt(makeAgent({ role: "backend" }), "dev");
    expect(prompt).toContain("Role: backend");
  });

  it("falls back to 'general' role when role is null", () => {
    const prompt = generateSystemPrompt(makeAgent({ role: null }), "dev");
    expect(prompt).toContain("Role: general");
  });

  it("Claim step is step 1", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toMatch(/1\.\s+\*\*Claim\*\*/);
  });

  it("Work step is step 2", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toMatch(/2\.\s+\*\*Work\*\*/);
  });

  it("PR step is step 3", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toMatch(/3\.\s+\*\*PR\*\*/);
  });

  it("Wait for CI step is step 4", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toMatch(/4\.\s+\*\*Wait for CI\*\*/);
  });

  it("Deliver step is step 5", () => {
    const prompt = generateSystemPrompt(makeAgent(), "dev");
    expect(prompt).toMatch(/5\.\s+\*\*Deliver\*\*/);
  });

  it("Handoff is described in its own section, not as a numbered lifecycle step", () => {
    // Handoff is an optional section added by buildHandoffSection, not step 6 in the lifecycle
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa"] }), "dev");
    expect(prompt).toContain("## Handoff");
    expect(prompt).not.toMatch(/^6\.\s+\*\*Handoff/m);
  });
});

// ─── OPS lifecycle ─────────────────────────────────────────────────────────

describe("generateSystemPrompt — ops board", () => {
  it("uses ak create note --task for progress logging", () => {
    const prompt = generateSystemPrompt(makeAgent(), "ops");
    expect(prompt).toContain("ak create note --task");
  });

  it("does NOT contain ak task log anywhere", () => {
    const prompt = generateSystemPrompt(makeAgent(), "ops");
    expect(prompt).not.toContain("ak task log");
  });

  it("does NOT contain ak wait pr (ops has no PR step)", () => {
    const prompt = generateSystemPrompt(makeAgent(), "ops");
    expect(prompt).not.toContain("ak wait pr");
  });

  it("does NOT contain gh pr create (ops has no PR step)", () => {
    const prompt = generateSystemPrompt(makeAgent(), "ops");
    expect(prompt).not.toContain("gh pr create");
  });

  it("Deliver step is step 3 in ops lifecycle", () => {
    const prompt = generateSystemPrompt(makeAgent(), "ops");
    expect(prompt).toMatch(/3\.\s+\*\*Deliver\*\*/);
  });
});

// ─── Handoff section ────────────────────────────────────────────────────────

describe("generateSystemPrompt — handoff section", () => {
  it("omits handoff section when handoff_to is null", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: null }), "dev");
    expect(prompt).not.toContain("## Handoff");
  });

  it("omits handoff section when handoff_to is empty array", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: [] }), "dev");
    expect(prompt).not.toContain("## Handoff");
  });

  it("includes handoff section when handoff_to has roles", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa", "devops"] }), "dev");
    expect(prompt).toContain("## Handoff");
  });

  it("lists handoff roles in handoff section", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa", "devops"] }), "dev");
    expect(prompt).toContain("qa, devops");
  });

  it("handoff section uses ak create note --task for logging the handoff", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa"] }), "dev");
    expect(prompt).toContain("ak create note --task <current-task-id>");
  });

  it("handoff section does NOT use ak task log for the handoff log step", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa"] }), "dev");
    expect(prompt).not.toContain("ak task log");
  });

  it("includes --repo flag in dev board handoff task create", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa"] }), "dev");
    expect(prompt).toContain("--repo <repo>");
  });

  it("does NOT include --repo flag in ops board handoff task create", () => {
    const prompt = generateSystemPrompt(makeAgent({ handoff_to: ["qa"] }), "ops");
    expect(prompt).not.toContain("--repo <repo>");
  });
});

// ─── Soul section ───────────────────────────────────────────────────────────

describe("generateSystemPrompt — soul", () => {
  it("includes soul content when provided", () => {
    const prompt = generateSystemPrompt(makeAgent({ soul: "Be concise." }), "dev");
    expect(prompt).toContain("Be concise.");
  });

  it("does not crash when soul is null", () => {
    expect(() => generateSystemPrompt(makeAgent({ soul: null }), "dev")).not.toThrow();
  });
});

// ─── writePromptFile / cleanupPromptFile ────────────────────────────────────

describe("writePromptFile", () => {
  it("writes content to a temp file named by session id", () => {
    const sessionId = `test-session-${Date.now()}`;
    const content = "test prompt content";
    const filePath = writePromptFile(sessionId, content);
    try {
      expect(readFileSync(filePath, "utf-8")).toBe(content);
      expect(filePath).toContain(`ak-prompt-${sessionId}.txt`);
    } finally {
      unlinkSync(filePath);
    }
  });

  it("returns the full path to the written file", () => {
    const sessionId = `test-session-path-${Date.now()}`;
    const filePath = writePromptFile(sessionId, "x");
    try {
      expect(filePath).toBe(join(tmpdir(), `ak-prompt-${sessionId}.txt`));
    } finally {
      unlinkSync(filePath);
    }
  });
});

describe("cleanupPromptFile", () => {
  it("deletes the prompt file for the given session id", () => {
    const sessionId = `test-cleanup-${Date.now()}`;
    const filePath = writePromptFile(sessionId, "content");
    expect(existsSync(filePath)).toBe(true);
    cleanupPromptFile(sessionId);
    expect(existsSync(filePath)).toBe(false);
  });

  it("does not throw when the file does not exist", () => {
    expect(() => cleanupPromptFile("nonexistent-session-xyz")).not.toThrow();
  });
});
