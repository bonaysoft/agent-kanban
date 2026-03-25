// @vitest-environment node
import { describe, expect, it } from "vitest";
import { claudeProvider } from "../src/providers/claude.js";
import { getAvailableProviders, getProvider, registerProvider } from "../src/providers/registry.js";
import type { AgentProvider } from "../src/providers/types.js";

// ---------------------------------------------------------------------------
// claudeProvider.buildArgs
// ---------------------------------------------------------------------------

describe("claudeProvider.buildArgs", () => {
  it("includes --print flag", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1" });
    expect(args).toContain("--print");
  });

  it("includes --verbose flag", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1" });
    expect(args).toContain("--verbose");
  });

  it("includes --input-format stream-json", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1" });
    const idx = args.indexOf("--input-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --output-format stream-json", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1" });
    const idx = args.indexOf("--output-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --dangerously-skip-permissions flag", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1" });
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --session-id with the provided session ID", () => {
    const args = claudeProvider.buildArgs({ sessionId: "abc-123" });
    const idx = args.indexOf("--session-id");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("abc-123");
  });

  it("does not include --system-prompt-file when systemPromptFile is absent", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1" });
    expect(args).not.toContain("--system-prompt-file");
  });

  it("appends --system-prompt-file when systemPromptFile is provided", () => {
    const args = claudeProvider.buildArgs({ sessionId: "s1", systemPromptFile: "/tmp/prompt.txt" });
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
    const args = claudeProvider.buildResumeArgs("sess-99");
    expect(args[0]).toBe("--resume");
  });

  it("includes the session ID immediately after --resume", () => {
    const args = claudeProvider.buildResumeArgs("sess-99");
    expect(args[1]).toBe("sess-99");
  });

  it("includes --print flag", () => {
    const args = claudeProvider.buildResumeArgs("sess-99");
    expect(args).toContain("--print");
  });

  it("includes --verbose flag", () => {
    const args = claudeProvider.buildResumeArgs("sess-99");
    expect(args).toContain("--verbose");
  });

  it("includes --dangerously-skip-permissions flag", () => {
    const args = claudeProvider.buildResumeArgs("sess-99");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes --input-format stream-json", () => {
    const args = claudeProvider.buildResumeArgs("sess-99");
    const idx = args.indexOf("--input-format");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --output-format stream-json", () => {
    const args = claudeProvider.buildResumeArgs("sess-99");
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
    expect(claudeProvider.parseEvent("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(claudeProvider.parseEvent("")).toBeNull();
  });

  it("returns null for unrecognised event type", () => {
    expect(claudeProvider.parseEvent(JSON.stringify({ type: "unknown_event" }))).toBeNull();
  });
});

describe("claudeProvider.parseEvent — rate_limit_event", () => {
  it("returns rate_limit when rate_limit_info.status is not allowed", () => {
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "blocked", resetsAt: 1700000000 },
    });
    const event = claudeProvider.parseEvent(raw);
    expect(event?.type).toBe("rate_limit");
  });

  it("resetAt is a valid ISO string derived from resetsAt epoch", () => {
    const resetsAt = 1700000000;
    const raw = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "blocked", resetsAt },
    });
    const event = claudeProvider.parseEvent(raw);
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
    expect(claudeProvider.parseEvent(raw)).toBeNull();
  });

  it("returns null when rate_limit_info is absent", () => {
    const raw = JSON.stringify({ type: "rate_limit_event" });
    expect(claudeProvider.parseEvent(raw)).toBeNull();
  });
});

describe("claudeProvider.parseEvent — assistant message", () => {
  it("returns a message event with the text content", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    const event = claudeProvider.parseEvent(raw);
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
    const event = claudeProvider.parseEvent(raw);
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
    expect(claudeProvider.parseEvent(raw)).toBeNull();
  });

  it("returns null when message content is missing", () => {
    const raw = JSON.stringify({ type: "assistant", message: {} });
    expect(claudeProvider.parseEvent(raw)).toBeNull();
  });
});

describe("claudeProvider.parseEvent — result", () => {
  it("returns a result event", () => {
    const raw = JSON.stringify({ type: "result", total_cost_usd: 0.05 });
    const event = claudeProvider.parseEvent(raw);
    expect(event?.type).toBe("result");
  });

  it("includes cost from total_cost_usd", () => {
    const raw = JSON.stringify({ type: "result", total_cost_usd: 0.12 });
    const event = claudeProvider.parseEvent(raw);
    if (event?.type === "result") {
      expect(event.cost).toBe(0.12);
    }
  });

  it("defaults cost to 0 when total_cost_usd is absent", () => {
    const raw = JSON.stringify({ type: "result" });
    const event = claudeProvider.parseEvent(raw);
    if (event?.type === "result") {
      expect(event.cost).toBe(0);
    }
  });

  it("includes usage when present", () => {
    const usage = { input_tokens: 100, output_tokens: 50 };
    const raw = JSON.stringify({ type: "result", total_cost_usd: 0, usage });
    const event = claudeProvider.parseEvent(raw);
    if (event?.type === "result") {
      expect(event.usage).toEqual(usage);
    }
  });
});

describe("claudeProvider.parseEvent — error variants", () => {
  it("returns error event when event.type is error", () => {
    const raw = JSON.stringify({ type: "error", message: "Something went wrong" });
    const event = claudeProvider.parseEvent(raw);
    expect(event?.type).toBe("error");
  });

  it("includes detail from event.message when error object is absent", () => {
    const raw = JSON.stringify({ type: "error", message: "Boom" });
    const event = claudeProvider.parseEvent(raw);
    if (event?.type === "error") {
      expect(event.detail).toContain("Boom");
    }
  });

  it("includes error code from event.error.type", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "Bad input" },
    });
    const event = claudeProvider.parseEvent(raw);
    if (event?.type === "error") {
      expect(event.code).toBe("invalid_request_error");
    }
  });

  it("returns rate_limit when error code is rate_limit_error", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limited" },
    });
    const event = claudeProvider.parseEvent(raw);
    expect(event?.type).toBe("rate_limit");
  });

  it("returns rate_limit when error code is overloaded_error", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    const event = claudeProvider.parseEvent(raw);
    expect(event?.type).toBe("rate_limit");
  });

  it("rate_limit resetAt for rate_limit_error is roughly 1 hour from now", () => {
    const before = Date.now();
    const raw = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limited" },
    });
    const event = claudeProvider.parseEvent(raw);
    const after = Date.now();
    if (event?.type === "rate_limit") {
      const resetMs = new Date(event.resetAt).getTime();
      expect(resetMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(resetMs).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    }
  });

  it("returns error event when event.error is present even without event.type=error", () => {
    const raw = JSON.stringify({ type: "assistant", error: { type: "some_error", message: "Oops" } });
    const event = claudeProvider.parseEvent(raw);
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
    const event = claudeProvider.parseEvent(raw);
    expect(event?.type).toBe("error");
    if (event?.type === "error") {
      expect(event.detail).toBe("Error explanation from content");
    }
  });
});

// ---------------------------------------------------------------------------
// claudeProvider.buildInput
// ---------------------------------------------------------------------------

describe("claudeProvider.buildInput", () => {
  it("returns valid JSON string", () => {
    const result = claudeProvider.buildInput("do the task");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("wraps context in user message envelope", () => {
    const parsed = JSON.parse(claudeProvider.buildInput("do the task"));
    expect(parsed.type).toBe("user");
    expect(parsed.message.role).toBe("user");
  });

  it("includes the task context as message content", () => {
    const parsed = JSON.parse(claudeProvider.buildInput("implement feature X"));
    expect(parsed.message.content).toBe("implement feature X");
  });

  it("handles empty string context", () => {
    const parsed = JSON.parse(claudeProvider.buildInput(""));
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

  it("command is claude", () => {
    expect(claudeProvider.command).toBe("claude");
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
    expect(() => getProvider("nonexistent-provider-xyz")).toThrow("Unknown provider: nonexistent-provider-xyz");
  });

  it("error message lists available providers", () => {
    expect(() => getProvider("ghost")).toThrow(/Available:/);
  });
});

describe("registry.registerProvider", () => {
  it("makes a newly registered provider retrievable by name", () => {
    const fake: AgentProvider = {
      name: "fake-provider-test",
      label: "Fake",
      command: "fake",
      buildArgs: () => [],
      buildResumeArgs: () => [],
      parseEvent: () => null,
      buildInput: (ctx) => ctx,
    };
    registerProvider(fake);
    expect(getProvider("fake-provider-test").name).toBe("fake-provider-test");
  });

  it("overwrites an existing provider with the same name", () => {
    const v1: AgentProvider = {
      name: "overwrite-test",
      label: "V1",
      command: "cmd",
      buildArgs: () => ["v1"],
      buildResumeArgs: () => [],
      parseEvent: () => null,
      buildInput: (ctx) => ctx,
    };
    const v2: AgentProvider = {
      name: "overwrite-test",
      label: "V2",
      command: "cmd",
      buildArgs: () => ["v2"],
      buildResumeArgs: () => [],
      parseEvent: () => null,
      buildInput: (ctx) => ctx,
    };
    registerProvider(v1);
    registerProvider(v2);
    expect(getProvider("overwrite-test").label).toBe("V2");
  });
});

describe("registry.getAvailableProviders", () => {
  it("returns an array", () => {
    const result = getAvailableProviders();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns only providers whose command exists on PATH", () => {
    // Each returned provider must pass a `which <command>` check.
    // We can verify this by registering a provider with a command that surely
    // does not exist and confirming it is not included.
    const ghost: AgentProvider = {
      name: "ghost-cmd-provider",
      label: "Ghost",
      command: "__definitely_not_a_real_command_xyz__",
      buildArgs: () => [],
      buildResumeArgs: () => [],
      parseEvent: () => null,
      buildInput: (ctx) => ctx,
    };
    registerProvider(ghost);
    const available = getAvailableProviders();
    expect(available.find((p) => p.name === "ghost-cmd-provider")).toBeUndefined();
  });
});
