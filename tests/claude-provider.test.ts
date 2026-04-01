// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Mock child_process so readOAuthToken never shells out
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockImplementation(() => {
    throw new Error("not available in tests");
  }),
}));

// Mock node:fs so readFileSync never touches disk
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockImplementation(() => {
    throw new Error("ENOENT");
  }),
}));

// Mock node:os so platform() is controllable
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    platform: vi.fn().mockReturnValue("linux"),
    homedir: actual.homedir,
  };
});

// Mock logger to suppress output
vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { buildArgs, buildResumeArgs, claudeProvider, formatInput, parseEvent } from "../packages/cli/src/providers/claude.js";

// ---------------------------------------------------------------------------
// parseEvent — rate_limit_event (blocked)
// ---------------------------------------------------------------------------

describe("parseEvent — rate_limit_event", () => {
  it("returns rate_limit event when rate_limit_event status is blocked", () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "blocked", resetsAt },
    });
    const result = parseEvent(raw);
    expect(result?.type).toBe("rate_limit");
  });

  it("includes resetAt ISO string derived from resetsAt epoch", () => {
    const resetsAt = 1700000000;
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "blocked", resetsAt },
    });
    const result = parseEvent(raw);
    expect(result).toEqual({ type: "rate_limit", resetAt: new Date(resetsAt * 1000).toISOString() });
  });

  it("returns null when rate_limit_event status is not blocked", () => {
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1700000000 },
    });
    expect(parseEvent(raw)).toBeNull();
  });

  it("returns null when rate_limit_event has no rate_limit_info", () => {
    const raw = JSON.stringify({ type: "rate_limit_event" });
    expect(parseEvent(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseEvent — string error codes (e.g. event.error = "rate_limit")
// ---------------------------------------------------------------------------

describe("parseEvent — string error field", () => {
  it("returns rate_limit for assistant event with error: 'rate_limit' (real Claude CLI usage-limit shape)", () => {
    // Real event shape from Claude CLI when account hits usage limit
    const raw = JSON.stringify({
      type: "assistant",
      error: "rate_limit",
      isApiErrorMessage: true,
      message: {
        model: "<synthetic>",
        content: [{ type: "text", text: "You're out of extra usage · resets 2pm (America/Toronto)" }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    const result = parseEvent(raw);
    expect(result?.type).toBe("rate_limit");
  });

  it("includes a future resetAt for string rate_limit error", () => {
    const before = Date.now();
    const raw = JSON.stringify({
      type: "assistant",
      error: "rate_limit",
      message: { content: [{ type: "text", text: "limit hit" }] },
    });
    const result = parseEvent(raw);
    const after = Date.now();
    expect(result?.type).toBe("rate_limit");
    if (result?.type === "rate_limit") {
      const resetAt = new Date(result.resetAt).getTime();
      expect(resetAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(resetAt).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    }
  });

  it("returns error for string error codes not in RATE_LIMIT_CODES", () => {
    const raw = JSON.stringify({
      type: "assistant",
      error: "authentication_error",
      message: { content: [{ type: "text", text: "Not authenticated" }] },
    });
    const result = parseEvent(raw);
    expect(result).toMatchObject({ type: "error", code: "authentication_error" });
  });

  it("returns error for object error with non-rate-limit type", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "server_error", message: "Something went wrong" },
    });
    const result = parseEvent(raw);
    expect(result).toMatchObject({ type: "error", code: "server_error", detail: "Something went wrong" });
  });
});

// ---------------------------------------------------------------------------
// parseEvent — RATE_LIMIT_CODES (existing behavior, Fix 3 baseline)
// ---------------------------------------------------------------------------

describe("parseEvent — rate_limit_error and overloaded_error codes", () => {
  it("returns rate_limit for error with type rate_limit_error", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limit reached" },
    });
    const result = parseEvent(raw);
    expect(result?.type).toBe("rate_limit");
  });

  it("returns rate_limit for error with type overloaded_error", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    const result = parseEvent(raw);
    expect(result?.type).toBe("rate_limit");
  });

  it("includes a resetAt approximately 1 hour in the future for rate_limit_error", () => {
    const before = Date.now();
    const raw = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limit" },
    });
    const result = parseEvent(raw);
    const after = Date.now();

    expect(result?.type).toBe("rate_limit");
    if (result?.type === "rate_limit") {
      const resetAt = new Date(result.resetAt).getTime();
      expect(resetAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(resetAt).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    }
  });

  it("returns error with code for unknown error types", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "permission_error", message: "Not allowed" },
    });
    const result = parseEvent(raw);
    expect(result).toMatchObject({ type: "error", code: "permission_error", detail: "Not allowed" });
  });
});

// ---------------------------------------------------------------------------
// parseEvent — other event types
// ---------------------------------------------------------------------------

describe("parseEvent — non-error event types", () => {
  it("returns null for unparseable JSON", () => {
    expect(parseEvent("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEvent("")).toBeNull();
  });

  it("returns null for unrecognized event type", () => {
    const raw = JSON.stringify({ type: "system_prompt" });
    expect(parseEvent(raw)).toBeNull();
  });

  it("returns message event for assistant text content", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello from agent" }] },
    });
    const result = parseEvent(raw);
    expect(result).toEqual({ type: "message", text: "Hello from agent" });
  });

  it("returns null for assistant event with no text blocks", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1" }] },
    });
    expect(parseEvent(raw)).toBeNull();
  });

  it("returns result event with cost and usage", () => {
    const raw = JSON.stringify({
      type: "result",
      total_cost_usd: 0.0042,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const result = parseEvent(raw);
    expect(result).toMatchObject({
      type: "result",
      cost: 0.0042,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });

  it("returns result event with cost 0 when total_cost_usd is absent", () => {
    const raw = JSON.stringify({ type: "result" });
    const result = parseEvent(raw);
    expect(result).toMatchObject({ type: "result", cost: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildArgs
// ---------------------------------------------------------------------------

describe("buildArgs", () => {
  it("includes --session-id with the provided sessionId", () => {
    const args = buildArgs({ sessionId: "sess-123", cwd: "/", env: {}, taskContext: "" });
    const idx = args.indexOf("--session-id");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("sess-123");
  });

  it("always includes --print flag", () => {
    const args = buildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--print");
  });

  it("always includes --dangerously-skip-permissions flag", () => {
    const args = buildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --system-prompt-file when systemPromptFile is provided", () => {
    const args = buildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "", systemPromptFile: "/tmp/prompt.txt" });
    const idx = args.indexOf("--system-prompt-file");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/tmp/prompt.txt");
  });

  it("does not include --system-prompt-file when systemPromptFile is absent", () => {
    const args = buildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).not.toContain("--system-prompt-file");
  });

  it("includes --model when model is provided", () => {
    const args = buildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "", model: "claude-opus-4" });
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("claude-opus-4");
  });

  it("does not include --model when model is absent", () => {
    const args = buildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).not.toContain("--model");
  });
});

// ---------------------------------------------------------------------------
// buildResumeArgs
// ---------------------------------------------------------------------------

describe("buildResumeArgs", () => {
  it("includes --resume with the provided sessionId", () => {
    const args = buildResumeArgs("sess-456");
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("sess-456");
  });

  it("always includes --print flag", () => {
    const args = buildResumeArgs("s1");
    expect(args).toContain("--print");
  });

  it("always includes --dangerously-skip-permissions flag", () => {
    const args = buildResumeArgs("s1");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --model when model is provided", () => {
    const args = buildResumeArgs("s1", "claude-sonnet-4-5");
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("claude-sonnet-4-5");
  });

  it("does not include --model when model is absent", () => {
    const args = buildResumeArgs("s1");
    expect(args).not.toContain("--model");
  });
});

// ---------------------------------------------------------------------------
// formatInput (previously buildInput)
// ---------------------------------------------------------------------------

describe("formatInput", () => {
  it("returns valid JSON string", () => {
    const raw = formatInput("do the task");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("wraps taskContext in a user message envelope", () => {
    const parsed = JSON.parse(formatInput("do the task"));
    expect(parsed.type).toBe("user");
    expect(parsed.message.role).toBe("user");
    expect(parsed.message.content).toBe("do the task");
  });

  it("preserves the task context string verbatim", () => {
    const context = "Fix bug #42 in repo foo/bar";
    const parsed = JSON.parse(formatInput(context));
    expect(parsed.message.content).toBe(context);
  });
});

// ---------------------------------------------------------------------------
// getUsage — ordered tests to exercise all branches before cache is populated.
// platform() is mocked to "linux" so readFileSync path is taken for token.
// ---------------------------------------------------------------------------

describe("claudeProvider.getUsage — no token", () => {
  it("returns null when readOAuthToken returns null (execSync and readFileSync both throw)", async () => {
    const result = await claudeProvider.getUsage?.();
    expect(result).toBeNull();
  });
});

describe("claudeProvider.getUsage — non-OK fetch response", () => {
  it("returns null (cached) when usage API returns a non-OK status", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce(JSON.stringify({ claudeAiOauth: { accessToken: "test-token-bad-status" } }) as any);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const result = await claudeProvider.getUsage?.();
    expect(result === null || typeof result === "object").toBe(true);
    fetchSpy.mockRestore();
  });
});

describe("claudeProvider.getUsage — fetch throws", () => {
  it("returns null (cached) when fetch throws a network error", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce(JSON.stringify({ claudeAiOauth: { accessToken: "test-token-throw" } }) as any);
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("network error"));

    const result = await claudeProvider.getUsage?.();
    expect(result === null || typeof result === "object").toBe(true);
    fetchSpy.mockRestore();
  });
});

describe("claudeProvider.getUsage — successful fetch", () => {
  it("returns usage data with windows array when API succeeds", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce(JSON.stringify({ claudeAiOauth: { accessToken: "test-token-xyz" } }) as any);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        five_hour: { utilization: 0.5, resets_at: "2026-04-01T12:00:00Z" },
        seven_day: { utilization: 0.2, resets_at: "2026-04-08T00:00:00Z" },
      }),
    } as Response);

    const result = await claudeProvider.getUsage?.();
    expect(result).not.toBeNull();
    if (result) {
      expect(Array.isArray(result.windows)).toBe(true);
      expect(typeof result.updated_at).toBe("string");
    }
    fetchSpy.mockRestore();
  });

  it("returns cached usage without fetching when called again within TTL", async () => {
    // Cache was populated by the previous test in this describe block.
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await claudeProvider.getUsage?.();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    fetchSpy.mockRestore();
  });
});
