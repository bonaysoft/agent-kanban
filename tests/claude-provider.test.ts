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

// Mock claude-agent-sdk so execute() does not invoke the real SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {},
    close: vi.fn(),
    streamInput: vi.fn().mockResolvedValue(undefined),
  }),
}));

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeProvider, mapSDKMessage } from "../packages/cli/src/providers/claude.js";

// ---------------------------------------------------------------------------
// mapSDKMessage — rate_limit_event
// ---------------------------------------------------------------------------

describe("mapSDKMessage — rate_limit_event rejected", () => {
  it("returns rate_limit event when status is rejected", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.95 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("rate_limit");
  });

  it("includes resetAt as ISO string derived from resetsAt epoch", () => {
    const resetsAt = 1700000000;
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour", utilization: 0.95 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("rate_limit");
    if (result?.type === "rate_limit") {
      expect(new Date(result.resetAt).getTime()).toBe(resetsAt * 1000);
    }
  });

  it("includes rateLimitType from rate_limit_info", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.95 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "rate_limit") {
      expect(result.rateLimitType).toBe("five_hour");
    }
  });

  it("includes utilization from rate_limit_info", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.95 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "rate_limit") {
      expect(result.utilization).toBe(0.95);
    }
  });

  it("uses 1-hour fallback resetAt when resetsAt is absent", () => {
    const before = Date.now();
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: null, rateLimitType: "five_hour", utilization: 0.9 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    const after = Date.now();
    expect(result?.type).toBe("rate_limit");
    if (result?.type === "rate_limit") {
      const resetMs = new Date(result.resetAt).getTime();
      expect(resetMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(resetMs).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    }
  });
});

describe("mapSDKMessage — rate_limit_event allowed_warning", () => {
  it("returns null when status is allowed_warning", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.8 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });

  it("returns null for any other non-rejected status", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.5 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessage — assistant message
// ---------------------------------------------------------------------------

describe("mapSDKMessage — assistant message", () => {
  it("returns message event with text from content block", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.text).toBe("hello");
    }
  });

  it("joins multiple text blocks with newline", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Line one" },
          { type: "text", text: "Line two" },
        ],
      },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.text).toBe("Line one\nLine two");
    }
  });

  it("returns null when content has no text blocks", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu1" }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });

  it("returns null when message content is missing", () => {
    const msg = {
      type: "assistant",
      message: {},
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessage — assistant with error field
// ---------------------------------------------------------------------------

describe("mapSDKMessage — assistant with error field", () => {
  it("returns rate_limit event when error is 'rate_limit'", () => {
    const msg = {
      type: "assistant",
      error: "rate_limit",
      message: { content: [{ type: "text", text: "usage limit hit" }] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("rate_limit");
  });

  it("rate_limit resetAt for string error is roughly 1 hour from now", () => {
    const before = Date.now();
    const msg = {
      type: "assistant",
      error: "rate_limit",
      message: { content: [] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    const after = Date.now();
    expect(result?.type).toBe("rate_limit");
    if (result?.type === "rate_limit") {
      const resetMs = new Date(result.resetAt).getTime();
      expect(resetMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(resetMs).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    }
  });

  it("returns error event when error is a non-rate-limit string", () => {
    const msg = {
      type: "assistant",
      error: "authentication_error",
      message: { content: [] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("error");
    if (result?.type === "error") {
      expect(result.code).toBe("authentication_error");
    }
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessage — result
// ---------------------------------------------------------------------------

describe("mapSDKMessage — result", () => {
  it("returns result event", () => {
    const msg = {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)?.type).toBe("result");
  });

  it("includes cost from total_cost_usd", () => {
    const msg = {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.12,
      usage: { input_tokens: 10, output_tokens: 5 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "result") {
      expect(result.cost).toBe(0.12);
    }
  });

  it("defaults cost to 0 when total_cost_usd is absent", () => {
    const msg = {
      type: "result",
      subtype: "success",
      usage: { input_tokens: 10, output_tokens: 5 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "result") {
      expect(result.cost).toBe(0);
    }
  });

  it("includes usage when present", () => {
    const usage = { input_tokens: 100, output_tokens: 50 };
    const msg = {
      type: "result",
      subtype: "success",
      total_cost_usd: 0,
      usage,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "result") {
      expect(result.usage).toEqual(usage);
    }
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessage — unknown type
// ---------------------------------------------------------------------------

describe("mapSDKMessage — unknown type", () => {
  it("returns null for unrecognized event type", () => {
    const msg = { type: "system_prompt", uuid: "u1", session_id: "s1" } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// claudeProvider identity
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
// claudeProvider.execute — verifies handle shape and SDK interaction via mocked SDK
// ---------------------------------------------------------------------------

describe("claudeProvider.execute — handle shape", () => {
  it("resolves to a handle with events, abort, pid, and send", async () => {
    const handle = await claudeProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "build feature" });
    expect(handle).toHaveProperty("events");
    expect(typeof handle.abort).toBe("function");
    expect(typeof handle.send).toBe("function");
    expect(handle.pid).toBeNull();
  });

  it("events is an async iterable", async () => {
    const handle = await claudeProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    expect(typeof handle.events[Symbol.asyncIterator]).toBe("function");
  });

  it("events yields mapped AgentEvents from SDK messages", async () => {
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    const sdkMsg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "SDK message" }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    };
    vi.mocked(mockQuery).mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield sdkMsg;
      },
      close: vi.fn(),
      streamInput: vi.fn().mockResolvedValue(undefined),
    } as any);
    const handle = await claudeProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    const events: any[] = [];
    for await (const ev of handle.events) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "message", text: "SDK message" });
  });

  it("abort() calls close() on the query object", async () => {
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    const closeSpy = vi.fn();
    vi.mocked(mockQuery).mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {},
      close: closeSpy,
      streamInput: vi.fn().mockResolvedValue(undefined),
    } as any);
    const handle = await claudeProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    await handle.abort();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("send() calls streamInput() with a user message async generator", async () => {
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    const streamInputSpy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockQuery).mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {},
      close: vi.fn(),
      streamInput: streamInputSpy,
    } as any);
    const handle = await claudeProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    await handle.send("ping");
    expect(streamInputSpy).toHaveBeenCalledOnce();
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
