// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Mock node:fs so readFileSync never touches disk (gemini reads system prompt file)
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockImplementation(() => {
    throw new Error("ENOENT");
  }),
}));

// Mock logger to suppress output
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock spawnHelper so execute() does not spawn real CLI processes
vi.mock("../src/providers/spawnHelper.js", () => ({
  spawnAgent: vi.fn().mockReturnValue({
    events: (async function* () {})(),
    abort: vi.fn().mockResolvedValue(undefined),
    pid: 12345,
    send: vi.fn().mockResolvedValue(undefined),
  }),
}));

import {
  buildArgs as claudeBuildArgs,
  buildResumeArgs as claudeBuildResumeArgs,
  parseEvent as claudeParseEvent,
  claudeProvider,
  formatInput,
} from "../src/providers/claude.js";
import {
  buildArgs as geminiBuildArgs,
  buildResumeArgs as geminiBuildResumeArgs,
  parseEvent as geminiParseEvent,
  geminiProvider,
} from "../src/providers/gemini.js";
import { getAvailableProviders, getProvider, registerProvider } from "../src/providers/registry.js";
import type { AgentProvider } from "../src/providers/types.js";

// ---------------------------------------------------------------------------
// claudeProvider.buildArgs
// ---------------------------------------------------------------------------

describe("claudeProvider.buildArgs", () => {
  it("includes --print flag", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--print");
  });

  it("includes --verbose flag", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--verbose");
  });

  it("includes --input-format stream-json", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    const idx = args.indexOf("--input-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --output-format stream-json", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    const idx = args.indexOf("--output-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --dangerously-skip-permissions flag", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --session-id with the provided session ID", () => {
    const args = claudeBuildArgs({ sessionId: "abc-123", cwd: "/", env: {}, taskContext: "" });
    const idx = args.indexOf("--session-id");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("abc-123");
  });

  it("does not include --system-prompt-file when systemPromptFile is absent", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).not.toContain("--system-prompt-file");
  });

  it("appends --system-prompt-file when systemPromptFile is provided", () => {
    const args = claudeBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "", systemPromptFile: "/tmp/prompt.txt" });
    const idx = args.indexOf("--system-prompt-file");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/tmp/prompt.txt");
  });
});

// ---------------------------------------------------------------------------
// claudeProvider.buildResumeArgs
// ---------------------------------------------------------------------------

describe("claudeProvider.buildResumeArgs", () => {
  it("starts with --resume flag", () => {
    const args = claudeBuildResumeArgs("sess-99");
    expect(args[0]).toBe("--resume");
  });

  it("includes the session ID immediately after --resume", () => {
    const args = claudeBuildResumeArgs("sess-99");
    expect(args[1]).toBe("sess-99");
  });

  it("includes --print flag", () => {
    const args = claudeBuildResumeArgs("sess-99");
    expect(args).toContain("--print");
  });

  it("includes --verbose flag", () => {
    const args = claudeBuildResumeArgs("sess-99");
    expect(args).toContain("--verbose");
  });

  it("includes --dangerously-skip-permissions flag", () => {
    const args = claudeBuildResumeArgs("sess-99");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --input-format stream-json", () => {
    const args = claudeBuildResumeArgs("sess-99");
    const idx = args.indexOf("--input-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --output-format stream-json", () => {
    const args = claudeBuildResumeArgs("sess-99");
    const idx = args.indexOf("--output-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });
});

// ---------------------------------------------------------------------------
// claudeProvider.parseEvent
// ---------------------------------------------------------------------------

describe("claudeProvider.parseEvent — invalid input", () => {
  it("returns null for non-JSON string", () => {
    expect(claudeParseEvent("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(claudeParseEvent("")).toBeNull();
  });

  it("returns null for unrecognised event type", () => {
    expect(claudeParseEvent(JSON.stringify({ type: "unknown_event" }))).toBeNull();
  });
});

describe("claudeProvider.parseEvent — rate_limit_event", () => {
  it("returns rate_limit when rate_limit_info.status is not allowed", () => {
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "blocked", resetsAt: 1700000000 },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("rate_limit");
  });

  it("resetAt is a valid ISO string derived from resetsAt epoch", () => {
    const resetsAt = 1700000000;
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "blocked", resetsAt },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("rate_limit");
    if (event?.type === "rate_limit") {
      expect(new Date(event.resetAt).getTime()).toBe(resetsAt * 1000);
    }
  });

  it("returns null when rate_limit_info.status is allowed", () => {
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1700000000 },
    });
    expect(claudeParseEvent(raw)).toBeNull();
  });

  it("returns null when rate_limit_info is absent", () => {
    const raw = JSON.stringify({ type: "rate_limit_event" });
    expect(claudeParseEvent(raw)).toBeNull();
  });
});

describe("claudeProvider.parseEvent — assistant message", () => {
  it("returns a message event with the text content", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("message");
    if (event?.type === "message") {
      expect(event.text).toBe("Hello world");
    }
  });

  it("joins multiple text blocks with newline", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Line one" },
          { type: "text", text: "Line two" },
        ],
      },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("message");
    if (event?.type === "message") {
      expect(event.text).toBe("Line one\nLine two");
    }
  });

  it("returns null when content has no text blocks", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu1" }] },
    });
    expect(claudeParseEvent(raw)).toBeNull();
  });

  it("returns null when message content is missing", () => {
    const raw = JSON.stringify({ type: "assistant", message: {} });
    expect(claudeParseEvent(raw)).toBeNull();
  });
});

describe("claudeProvider.parseEvent — result", () => {
  it("returns a result event", () => {
    const raw = JSON.stringify({ type: "result", total_cost_usd: 0.05 });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("result");
  });

  it("includes cost from total_cost_usd", () => {
    const raw = JSON.stringify({ type: "result", total_cost_usd: 0.12 });
    const event = claudeParseEvent(raw);
    if (event?.type === "result") {
      expect(event.cost).toBe(0.12);
    }
  });

  it("defaults cost to 0 when total_cost_usd is absent", () => {
    const raw = JSON.stringify({ type: "result" });
    const event = claudeParseEvent(raw);
    if (event?.type === "result") {
      expect(event.cost).toBe(0);
    }
  });

  it("includes usage when present", () => {
    const usage = { input_tokens: 100, output_tokens: 50 };
    const raw = JSON.stringify({ type: "result", total_cost_usd: 0, usage });
    const event = claudeParseEvent(raw);
    if (event?.type === "result") {
      expect(event.usage).toEqual(usage);
    }
  });
});

describe("claudeProvider.parseEvent — error variants", () => {
  it("returns error event when event.type is error", () => {
    const raw = JSON.stringify({ type: "error", message: "Something went wrong" });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("error");
  });

  it("includes detail from event.message when error object is absent", () => {
    const raw = JSON.stringify({ type: "error", message: "Boom" });
    const event = claudeParseEvent(raw);
    if (event?.type === "error") {
      expect(event.detail).toContain("Boom");
    }
  });

  it("includes error code from event.error.type", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "Bad input" },
    });
    const event = claudeParseEvent(raw);
    if (event?.type === "error") {
      expect(event.code).toBe("invalid_request_error");
    }
  });

  it("returns rate_limit when error code is rate_limit_error", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limited" },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("rate_limit");
  });

  it("returns rate_limit when error code is overloaded_error", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("rate_limit");
  });

  it("rate_limit resetAt for rate_limit_error is roughly 1 hour from now", () => {
    const before = Date.now();
    const raw = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limited" },
    });
    const event = claudeParseEvent(raw);
    const after = Date.now();
    if (event?.type === "rate_limit") {
      const resetMs = new Date(event.resetAt).getTime();
      expect(resetMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(resetMs).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    }
  });

  it("returns error event when event.error is present even without event.type=error", () => {
    const raw = JSON.stringify({ type: "assistant", error: { type: "some_error", message: "Oops" } });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("error");
  });

  it("uses assistant message text block as detail when event has both error and assistant content", () => {
    const raw = JSON.stringify({
      type: "assistant",
      error: { type: "some_error", message: "fallback" },
      message: {
        content: [{ type: "text", text: "Error explanation from content" }],
      },
    });
    const event = claudeParseEvent(raw);
    expect(event?.type).toBe("error");
    if (event?.type === "error") {
      expect(event.detail).toBe("Error explanation from content");
    }
  });
});

// ---------------------------------------------------------------------------
// claudeProvider.buildInput (now formatInput)
// ---------------------------------------------------------------------------

describe("claudeProvider.buildInput", () => {
  it("returns valid JSON string", () => {
    const result = formatInput("do the task");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("wraps context in user message envelope", () => {
    const parsed = JSON.parse(formatInput("do the task"));
    expect(parsed.type).toBe("user");
    expect(parsed.message.role).toBe("user");
  });

  it("includes the task context as message content", () => {
    const parsed = JSON.parse(formatInput("implement feature X"));
    expect(parsed.message.content).toBe("implement feature X");
  });

  it("handles empty string context", () => {
    const parsed = JSON.parse(formatInput(""));
    expect(parsed.message.content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// claudeProvider identity fields
// ---------------------------------------------------------------------------

describe("claudeProvider identity", () => {
  it("name is claude", () => {
    expect(claudeProvider.name).toBe("claude");
  });

  it("label is Claude Code", () => {
    expect(claudeProvider.label).toBe("Claude Code");
  });
});

// ---------------------------------------------------------------------------
// registry: registerProvider / getProvider / getAvailableProviders
// ---------------------------------------------------------------------------

describe("registry.getProvider", () => {
  it("returns claudeProvider which is registered by default", () => {
    const provider = getProvider("claude");
    expect(provider.name).toBe("claude");
  });

  it("throws when provider name is not registered", () => {
    expect(() => getProvider("nonexistent-provider-xyz" as any)).toThrow("Unknown provider: nonexistent-provider-xyz");
  });

  it("error message lists available providers", () => {
    expect(() => getProvider("ghost" as any)).toThrow(/Available:/);
  });
});

describe("registry.registerProvider", () => {
  it("makes a newly registered provider retrievable by name", () => {
    const fake: AgentProvider = {
      name: "fake-provider-test" as any,
      label: "Fake",
      execute: async () => ({ events: (async function* () {})(), abort: async () => {}, pid: null, send: async () => {} }),
    };
    registerProvider(fake);
    expect(getProvider("fake-provider-test" as any).name).toBe("fake-provider-test");
  });

  it("overwrites an existing provider with the same name", () => {
    const v1: AgentProvider = {
      name: "overwrite-test" as any,
      label: "V1",
      execute: async () => ({ events: (async function* () {})(), abort: async () => {}, pid: null, send: async () => {} }),
    };
    const v2: AgentProvider = {
      name: "overwrite-test" as any,
      label: "V2",
      execute: async () => ({ events: (async function* () {})(), abort: async () => {}, pid: null, send: async () => {} }),
    };
    registerProvider(v1);
    registerProvider(v2);
    expect(getProvider("overwrite-test" as any).label).toBe("V2");
  });
});

describe("registry.getAvailableProviders", () => {
  it("returns an array", () => {
    const result = getAvailableProviders();
    expect(Array.isArray(result)).toBe(true);
  });

  it("does not include providers whose runtime command does not exist on PATH", () => {
    // ghost-cmd-provider uses a name not in RUNTIME_COMMANDS, so it is filtered out
    const ghost: AgentProvider = {
      name: "ghost-cmd-provider" as any,
      label: "Ghost",
      execute: async () => ({ events: (async function* () {})(), abort: async () => {}, pid: null, send: async () => {} }),
    };
    registerProvider(ghost);
    const available = getAvailableProviders();
    expect(available.find((p) => p.name === "ghost-cmd-provider")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// geminiProvider identity fields
// ---------------------------------------------------------------------------

describe("geminiProvider identity", () => {
  it("name is gemini", () => {
    expect(geminiProvider.name).toBe("gemini");
  });

  it("label is Gemini CLI", () => {
    expect(geminiProvider.label).toBe("Gemini CLI");
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.buildArgs
// ---------------------------------------------------------------------------

describe("geminiProvider.buildArgs", () => {
  it("includes --output-format stream-json", () => {
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    const idx = args.indexOf("--output-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --yolo flag", () => {
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--yolo");
  });

  it("includes --prompt flag", () => {
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).toContain("--prompt");
  });

  it("returns an array", () => {
    expect(Array.isArray(geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" }))).toBe(true);
  });

  it("does not include --session-id flag (Gemini has no session concept)", () => {
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).not.toContain("--session-id");
  });

  it("includes --model when model is provided", () => {
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "", model: "gemini-2.5-pro" });
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("gemini-2.5-pro");
  });

  it("does not include --model when model is absent", () => {
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "" });
    expect(args).not.toContain("--model");
  });

  it("uses system prompt content from file when systemPromptFile is provided and readable", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce("You are a helpful assistant." as any);
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "", systemPromptFile: "/tmp/system.txt" });
    const promptIdx = args.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(args[promptIdx + 1]).toBe("You are a helpful assistant.");
  });

  it("uses empty string as prompt when systemPromptFile cannot be read", () => {
    // readFileSync is already mocked to throw by default
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "", systemPromptFile: "/nonexistent/file.txt" });
    const promptIdx = args.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(args[promptIdx + 1]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.buildResumeArgs
// ---------------------------------------------------------------------------

describe("geminiProvider.buildResumeArgs", () => {
  it("returns an array", () => {
    expect(Array.isArray(geminiBuildResumeArgs())).toBe(true);
  });

  it("includes --output-format stream-json (falls back to fresh session)", () => {
    const args = geminiBuildResumeArgs();
    const idx = args.indexOf("--output-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --yolo flag (fresh session fallback)", () => {
    const args = geminiBuildResumeArgs();
    expect(args).toContain("--yolo");
  });

  it("includes --resume latest (Gemini resumes the latest session rather than by ID)", () => {
    const args = geminiBuildResumeArgs();
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("latest");
  });

  it("includes --model when model is provided", () => {
    const args = geminiBuildResumeArgs("gemini-2.5-pro");
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("gemini-2.5-pro");
  });

  it("does not include --model when model is absent", () => {
    const args = geminiBuildResumeArgs();
    expect(args).not.toContain("--model");
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.parseEvent — invalid / unrecognised input
// ---------------------------------------------------------------------------

describe("geminiProvider.parseEvent — invalid input", () => {
  it("returns null for non-JSON string", () => {
    expect(geminiParseEvent("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(geminiParseEvent("")).toBeNull();
  });

  it("returns null for unrecognised event type", () => {
    expect(geminiParseEvent(JSON.stringify({ type: "unknown_event" }))).toBeNull();
  });

  it("returns null for init event", () => {
    const raw = JSON.stringify({ type: "init", timestamp: "2024-01-01T00:00:00Z", session_id: "s1", model: "gemini-pro" });
    expect(geminiParseEvent(raw)).toBeNull();
  });

  it("returns null for user message event", () => {
    const raw = JSON.stringify({ type: "message", role: "user", content: "hello" });
    expect(geminiParseEvent(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.parseEvent — assistant message
// ---------------------------------------------------------------------------

describe("geminiProvider.parseEvent — assistant message", () => {
  it("returns a message event for assistant role with content", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "Hello world" });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("message");
  });

  it("includes the content as text", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "Hello world" });
    const event = geminiParseEvent(raw);
    if (event?.type === "message") {
      expect(event.text).toBe("Hello world");
    }
  });

  it("handles delta assistant message with content", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "partial text", delta: true });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("message");
    if (event?.type === "message") {
      expect(event.text).toBe("partial text");
    }
  });

  it("returns null for assistant message without content", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant" });
    expect(geminiParseEvent(raw)).toBeNull();
  });

  it("returns null for assistant message with empty content string", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "" });
    expect(geminiParseEvent(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.parseEvent — result
// ---------------------------------------------------------------------------

describe("geminiProvider.parseEvent — result", () => {
  it("returns a result event", () => {
    const raw = JSON.stringify({ type: "result", status: "success", stats: { total_tokens: 100, input_tokens: 60, output_tokens: 40 } });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("result");
  });

  it("includes stats as usage", () => {
    const stats = { total_tokens: 100, input_tokens: 60, output_tokens: 40 };
    const raw = JSON.stringify({ type: "result", status: "success", stats });
    const event = geminiParseEvent(raw);
    if (event?.type === "result") {
      expect(event.usage).toEqual(stats);
    }
  });

  it("includes usage as undefined when stats is absent", () => {
    const raw = JSON.stringify({ type: "result", status: "success" });
    const event = geminiParseEvent(raw);
    if (event?.type === "result") {
      expect(event.usage).toBeUndefined();
    }
  });

  it("returns zero cost when no model breakdown is present", () => {
    const raw = JSON.stringify({ type: "result", status: "success", stats: {} });
    const event = geminiParseEvent(raw);
    if (event?.type === "result") {
      expect(event.cost).toBe(0);
    }
  });

  it("calculates cost from per-model token breakdown", () => {
    const raw = JSON.stringify({
      type: "result",
      stats: {
        models: {
          "gemini-2.5-flash-lite": { input_tokens: 1_000_000, output_tokens: 1_000_000 },
          "gemini-2.5-pro": { input_tokens: 500_000, output_tokens: 200_000 },
        },
      },
    });
    const event = geminiParseEvent(raw);
    // flash-lite: 1M * 0.10/1M + 1M * 0.40/1M = 0.50
    // pro: 500K * 1.25/1M + 200K * 10.00/1M = 0.625 + 2.00 = 2.625
    // total: 3.125
    expect(event?.type).toBe("result");
    if (event?.type === "result") {
      expect(event.cost).toBeCloseTo(3.125, 6);
    }
  });

  it("skips unknown models in cost calculation", () => {
    const raw = JSON.stringify({
      type: "result",
      stats: {
        models: {
          "gemini-unknown-model": { input_tokens: 1000, output_tokens: 1000 },
          "gemini-2.5-flash": { input_tokens: 1_000_000, output_tokens: 0 },
        },
      },
    });
    const event = geminiParseEvent(raw);
    // only flash counted: 1M * 0.30/1M = 0.30
    expect(event?.type).toBe("result");
    if (event?.type === "result") {
      expect(event.cost).toBeCloseTo(0.3, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.parseEvent — error variants
// ---------------------------------------------------------------------------

describe("geminiProvider.parseEvent — error variants", () => {
  it("returns error event when event.type is error", () => {
    const raw = JSON.stringify({ type: "error", message: "Something went wrong" });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("error");
  });

  it("includes detail from event.message when type is error", () => {
    const raw = JSON.stringify({ type: "error", message: "Boom" });
    const event = geminiParseEvent(raw);
    if (event?.type === "error") {
      expect(event.detail).toContain("Boom");
    }
  });

  it("returns error event when event.status is error and type is not result", () => {
    const raw = JSON.stringify({ type: "message", role: "system", status: "error", error: "Generation failed" });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("error");
  });

  it("includes detail from event.error when status is error and error field is present", () => {
    const raw = JSON.stringify({ type: "message", role: "system", status: "error", error: "Generation failed" });
    const event = geminiParseEvent(raw);
    if (event?.type === "error") {
      expect(event.detail).toContain("Generation failed");
    }
  });

  it("result event with status error still returns result (type check takes precedence over status)", () => {
    const raw = JSON.stringify({ type: "result", status: "error", stats: {} });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("result");
  });

  it("falls back to JSON stringified event as detail when message and error are absent", () => {
    const raw = JSON.stringify({ type: "error" });
    const event = geminiParseEvent(raw);
    if (event?.type === "error") {
      expect(typeof event.detail).toBe("string");
      expect(event.detail.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.buildInput — Gemini passes context directly as input
// ---------------------------------------------------------------------------

describe("geminiProvider.buildInput", () => {
  it("execute passes task context directly as input (not wrapped)", () => {
    // Gemini's input is the raw taskContext string — verified by the buildArgs/execute design.
    // We verify this by confirming buildArgs does not add a JSON wrapper flag.
    const args = geminiBuildArgs({ sessionId: "s1", cwd: "/", env: {}, taskContext: "do the task" });
    expect(args).not.toContain("--input-format");
  });
});

// ---------------------------------------------------------------------------
// registry: geminiProvider is registered by default
// ---------------------------------------------------------------------------

describe("registry.getProvider — gemini", () => {
  it("returns geminiProvider which is registered by default", () => {
    const provider = getProvider("gemini");
    expect(provider.name).toBe("gemini");
  });

  it("returned provider label is Gemini CLI", () => {
    expect(getProvider("gemini").label).toBe("Gemini CLI");
  });
});

// ---------------------------------------------------------------------------
// geminiProvider.execute — verifies arg selection via mocked spawnAgent
// ---------------------------------------------------------------------------

describe("geminiProvider.execute — arg selection", () => {
  it("resolves to an AgentHandle with events, abort, pid, and send", async () => {
    const { spawnAgent } = await import("../src/providers/spawnHelper.js");
    const handle = await geminiProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "build feature" });
    expect(handle).toHaveProperty("events");
    expect(typeof handle.abort).toBe("function");
    expect(typeof handle.send).toBe("function");
    expect(spawnAgent).toHaveBeenCalled();
  });

  it("passes taskContext as input to spawnAgent", async () => {
    const { spawnAgent } = await import("../src/providers/spawnHelper.js");
    vi.mocked(spawnAgent).mockClear();
    await geminiProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "my task context" });
    expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(expect.objectContaining({ input: "my task context" }));
  });

  it("uses buildResumeArgs when resume is true", async () => {
    const { spawnAgent } = await import("../src/providers/spawnHelper.js");
    vi.mocked(spawnAgent).mockClear();
    await geminiProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx", resume: true });
    const call = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(call.args).toContain("--resume");
  });

  it("uses buildArgs when resume is false or absent", async () => {
    const { spawnAgent } = await import("../src/providers/spawnHelper.js");
    vi.mocked(spawnAgent).mockClear();
    await geminiProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    const call = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(call.args).not.toContain("--resume");
  });
});
