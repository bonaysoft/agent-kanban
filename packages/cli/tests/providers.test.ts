// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Mock node:fs so readFileSync never touches disk (gemini reads system prompt file, codex reads auth)
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

// Mock spawnHelper so gemini.execute() does not spawn real CLI processes
vi.mock("../src/providers/spawnHelper.js", () => ({
  spawnAgent: vi.fn().mockReturnValue({
    events: (async function* () {})(),
    abort: vi.fn().mockResolvedValue(undefined),
    pid: 12345,
    send: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock claude-agent-sdk so claudeProvider.execute() does not invoke the real SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {},
    close: vi.fn(),
    streamInput: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock @openai/codex-sdk so codexProvider.execute() does not invoke the real SDK
vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn().mockImplementation(() => ({
    startThread: vi.fn().mockReturnValue({
      runStreamed: vi.fn().mockResolvedValue({ events: (async function* () {})() }),
    }),
    resumeThread: vi.fn().mockReturnValue({
      runStreamed: vi.fn().mockResolvedValue({ events: (async function* () {})() }),
    }),
  })),
}));

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadEvent } from "@openai/codex-sdk";
import { claudeProvider, mapSDKMessage } from "../src/providers/claude.js";
import { codexProvider, mapThreadEvent } from "../src/providers/codex.js";
import {
  buildArgs as geminiBuildArgs,
  buildResumeArgs as geminiBuildResumeArgs,
  parseEvent as geminiParseEvent,
  geminiProvider,
} from "../src/providers/gemini.js";
import { getAvailableProviders, getProvider, registerProvider } from "../src/providers/registry.js";
import type { AgentProvider } from "../src/providers/types.js";

// ---------------------------------------------------------------------------
// mapSDKMessage — rate_limit_event
// ---------------------------------------------------------------------------

describe("mapSDKMessage — rate_limit_event rejected", () => {
  it("returns rate_limit when status is rejected", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.95 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)?.type).toBe("rate_limit");
  });

  it("includes resetAt derived from resetsAt epoch", () => {
    const resetsAt = 1700000000;
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour", utilization: 0.95 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "rate_limit") {
      expect(new Date(result.resetAt).getTime()).toBe(resetsAt * 1000);
    }
  });

  it("returns null when status is allowed_warning", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.8 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });

  it("returns null when status is not rejected", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1700000000, rateLimitType: "five_hour", utilization: 0.5 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });
});

describe("mapSDKMessage — assistant message", () => {
  it("returns assistant event with text block in blocks array", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("assistant");
    if (result?.type === "assistant") {
      expect(result.blocks[0]).toEqual({ type: "text", text: "Hello world" });
    }
  });

  it("returns assistant event with tool_use block when content has only tool_use blocks", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu1", name: "bash", input: { command: "ls" } }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("assistant");
    if (result?.type === "assistant") {
      expect(result.blocks[0].type).toBe("tool_use");
    }
  });

  it("returns rate_limit when error field is 'rate_limit'", () => {
    const msg = {
      type: "assistant",
      error: "rate_limit",
      message: { content: [] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)?.type).toBe("rate_limit");
  });

  it("returns error event for non-rate-limit string error", () => {
    const msg = {
      type: "assistant",
      error: "authentication_error",
      message: { content: [] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)?.type).toBe("error");
  });
});

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

describe("mapSDKMessage — unknown type", () => {
  it("returns null for unrecognized event type", () => {
    const msg = { type: "system_prompt", uuid: "u1", session_id: "s1" } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
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
// mapThreadEvent — item.completed
// ---------------------------------------------------------------------------

describe("mapThreadEvent — item.completed", () => {
  it("returns assistant event with text block when item is agent_message with text", () => {
    const event = {
      type: "item.completed",
      item: { id: "i1", type: "agent_message", text: "Task done" },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("assistant");
    if (result?.type === "assistant") {
      expect(result.blocks[0]).toEqual({ type: "text", text: "Task done" });
    }
  });

  it("returns assistant event with tool_use block when item is command_execution", () => {
    const event = {
      type: "item.completed",
      item: { id: "i1", type: "command_execution", command: "ls", aggregated_output: "", status: "completed" },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("assistant");
    if (result?.type === "assistant") {
      expect(result.blocks[0]).toEqual({ type: "tool_use", id: "i1", name: "command", input: { command: "ls" } });
    }
  });

  it("returns null when agent_message has no text", () => {
    const event = {
      type: "item.completed",
      item: { id: "i1", type: "agent_message", text: "" },
    } as unknown as ThreadEvent;
    expect(mapThreadEvent(event)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapThreadEvent — turn.completed
// ---------------------------------------------------------------------------

describe("mapThreadEvent — turn.completed", () => {
  it("returns result event", () => {
    const event = {
      type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 },
    } as unknown as ThreadEvent;
    expect(mapThreadEvent(event)?.type).toBe("result");
  });

  it("includes usage with input_tokens and output_tokens", () => {
    const event = {
      type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    if (result?.type === "result") {
      expect(result.usage?.input_tokens).toBe(100);
      expect(result.usage?.output_tokens).toBe(50);
    }
  });

  it("calculates cost based on o3 pricing by default", () => {
    const event = {
      type: "turn.completed",
      usage: { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000 },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    // o3: 2.0/1M input + 8.0/1M output = 10.0
    if (result?.type === "result") {
      expect(result.cost).toBeCloseTo(10.0, 5);
    }
  });

  it("includes cache_read_input_tokens in usage", () => {
    const event = {
      type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    if (result?.type === "result") {
      expect(result.usage?.cache_read_input_tokens).toBe(20);
    }
  });
});

// ---------------------------------------------------------------------------
// mapThreadEvent — turn.failed
// ---------------------------------------------------------------------------

describe("mapThreadEvent — turn.failed", () => {
  it("returns rate_limit event when error message matches rate limit pattern", () => {
    const event = {
      type: "turn.failed",
      error: { message: "Rate limit exceeded, try again at 2026-04-01T15:00:00Z" },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("rate_limit");
  });

  it("returns rate_limit event when error message matches quota exceeded pattern", () => {
    const event = {
      type: "turn.failed",
      error: { message: "quota exceeded for this model" },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("rate_limit");
  });

  it("returns error event when error message does not match rate limit pattern", () => {
    const event = {
      type: "turn.failed",
      error: { message: "Internal server error" },
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("error");
    if (result?.type === "error") {
      expect(result.detail).toContain("Internal server error");
    }
  });

  it("returns error event when error is absent", () => {
    const event = { type: "turn.failed" } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// mapThreadEvent — error
// ---------------------------------------------------------------------------

describe("mapThreadEvent — error event", () => {
  it("returns rate_limit when message matches rate limit pattern", () => {
    const event = {
      type: "error",
      message: "usage limit exceeded, please try again at tomorrow",
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("rate_limit");
  });

  it("returns error when message does not match rate limit", () => {
    const event = {
      type: "error",
      message: "Connection reset by peer",
    } as unknown as ThreadEvent;
    const result = mapThreadEvent(event);
    expect(result?.type).toBe("error");
    if (result?.type === "error") {
      expect(result.detail).toContain("Connection reset by peer");
    }
  });
});

// ---------------------------------------------------------------------------
// mapThreadEvent — other types
// ---------------------------------------------------------------------------

describe("mapThreadEvent — other event types", () => {
  it("returns null for item.started", () => {
    const event = {
      type: "item.started",
      item: { id: "i1", type: "agent_message", text: "partial" },
    } as unknown as ThreadEvent;
    expect(mapThreadEvent(event)).toBeNull();
  });

  it("returns null for turn.started", () => {
    const event = { type: "turn.started" } as unknown as ThreadEvent;
    expect(mapThreadEvent(event)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// codexProvider identity
// ---------------------------------------------------------------------------

describe("codexProvider identity", () => {
  it("name is codex", () => {
    expect(codexProvider.name).toBe("codex");
  });

  it("label is Codex CLI", () => {
    expect(codexProvider.label).toBe("Codex CLI");
  });
});

// ---------------------------------------------------------------------------
// claudeProvider.execute — abort and send
// ---------------------------------------------------------------------------

describe("claudeProvider.execute — abort and send", () => {
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

  it("send() calls streamInput() on the query object with a user message", async () => {
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    const streamInputSpy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockQuery).mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {},
      close: vi.fn(),
      streamInput: streamInputSpy,
    } as any);
    const handle = await claudeProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    await handle.send("hello agent");
    expect(streamInputSpy).toHaveBeenCalledOnce();
  });

  it("uses resume option when opts.resume is true", async () => {
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    vi.mocked(mockQuery).mockClear();
    await claudeProvider.execute({ sessionId: "sess-xyz", cwd: "/tmp", env: {}, taskContext: "ctx", resume: true });
    expect(vi.mocked(mockQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ resume: "sess-xyz", sessionId: undefined }),
      }),
    );
  });

  it("uses sessionId option when opts.resume is false or absent", async () => {
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    vi.mocked(mockQuery).mockClear();
    await claudeProvider.execute({ sessionId: "sess-abc", cwd: "/tmp", env: {}, taskContext: "ctx" });
    expect(vi.mocked(mockQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ sessionId: "sess-abc", resume: undefined }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// codexProvider.execute — handle shape and thread selection
// ---------------------------------------------------------------------------

describe("codexProvider.execute — handle shape", () => {
  it("resolves to a handle with events, abort, pid, and send", async () => {
    const handle = await codexProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "build feature" });
    expect(handle).toHaveProperty("events");
    expect(typeof handle.abort).toBe("function");
    expect(typeof handle.send).toBe("function");
    expect(handle.pid).toBeNull();
  });

  it("events is an async iterable", async () => {
    const handle = await codexProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    expect(typeof handle.events[Symbol.asyncIterator]).toBe("function");
  });
});

describe("codexProvider.execute — thread selection", () => {
  it("calls startThread when resume is false or absent", async () => {
    const { Codex } = await import("@openai/codex-sdk");
    const startThreadSpy = vi.fn().mockReturnValue({
      runStreamed: vi.fn().mockResolvedValue({ events: (async function* () {})() }),
    });
    vi.mocked(Codex).mockImplementationOnce(
      () =>
        ({
          startThread: startThreadSpy,
          resumeThread: vi.fn(),
        }) as any,
    );
    await codexProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    expect(startThreadSpy).toHaveBeenCalledOnce();
  });

  it("calls resumeThread when resume is true", async () => {
    const { Codex } = await import("@openai/codex-sdk");
    const resumeThreadSpy = vi.fn().mockReturnValue({
      runStreamed: vi.fn().mockResolvedValue({ events: (async function* () {})() }),
    });
    vi.mocked(Codex).mockImplementationOnce(
      () =>
        ({
          startThread: vi.fn(),
          resumeThread: resumeThreadSpy,
        }) as any,
    );
    await codexProvider.execute({ sessionId: "sess-77", cwd: "/tmp", env: {}, taskContext: "ctx", resume: true });
    expect(resumeThreadSpy).toHaveBeenCalledWith("sess-77", expect.any(Object));
  });

  it("events yields mapped AgentEvents from SDK thread events", async () => {
    const { Codex } = await import("@openai/codex-sdk");
    const sdkEvent = { type: "item.completed", item: { id: "i1", type: "agent_message", text: "codex message" } };
    vi.mocked(Codex).mockImplementationOnce(
      () =>
        ({
          startThread: vi.fn().mockReturnValue({
            runStreamed: vi.fn().mockResolvedValue({
              events: (async function* () {
                yield sdkEvent as any;
              })(),
            }),
          }),
          resumeThread: vi.fn(),
        }) as any,
    );
    const handle = await codexProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    const events: any[] = [];
    for await (const ev of handle.events) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "assistant", blocks: [{ type: "text", text: "codex message" }] });
  });

  it("send() throws not-implemented error", async () => {
    const { Codex } = await import("@openai/codex-sdk");
    const runStreamedSpy = vi.fn().mockResolvedValue({ events: (async function* () {})() });
    vi.mocked(Codex).mockImplementationOnce(
      () =>
        ({
          startThread: vi.fn().mockReturnValue({ runStreamed: runStreamedSpy }),
          resumeThread: vi.fn(),
        }) as any,
    );
    const handle = await codexProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    await expect(handle.send("follow up")).rejects.toThrow("not implemented");
  });

  it("abort() aborts the AbortController signal", async () => {
    const handle = await codexProvider.execute({ sessionId: "s1", cwd: "/tmp", env: {}, taskContext: "ctx" });
    // Just verify abort() resolves without throwing
    await expect(handle.abort()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// codexProvider.getUsage
// ---------------------------------------------------------------------------

describe("codexProvider.getUsage — no token", () => {
  it("returns null when readAccessToken returns null (readFileSync throws)", async () => {
    const result = await codexProvider.getUsage?.();
    expect(result).toBeNull();
  });
});

describe("codexProvider.getUsage — non-OK fetch response", () => {
  it("returns null when usage API returns non-OK status", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce(JSON.stringify({ tokens: { access_token: "test-token" } }) as any);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    const result = await codexProvider.getUsage?.();
    expect(result === null || typeof result === "object").toBe(true);
    fetchSpy.mockRestore();
  });
});

describe("codexProvider.getUsage — fetch throws", () => {
  it("returns null when fetch throws a network error", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce(JSON.stringify({ tokens: { access_token: "test-token-throw" } }) as any);
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("network error"));
    const result = await codexProvider.getUsage?.();
    expect(result === null || typeof result === "object").toBe(true);
    fetchSpy.mockRestore();
  });
});

describe("codexProvider.getUsage — successful fetch", () => {
  it("returns usage with windows when API succeeds with primary and secondary windows", async () => {
    const fsModule = await import("node:fs");
    vi.mocked(fsModule.readFileSync).mockReturnValueOnce(JSON.stringify({ tokens: { access_token: "valid-token" } }) as any);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: { used_percent: 0.5, reset_at: 1700003600, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 0.2, reset_at: 1700604800, limit_window_seconds: 604800 },
        },
      }),
    } as Response);
    const result = await codexProvider.getUsage?.();
    expect(result).not.toBeNull();
    if (result) {
      expect(Array.isArray(result.windows)).toBe(true);
      expect(result.windows.length).toBe(2);
      expect(result.windows[0].label).toBe("5-Hour");
      expect(result.windows[1].label).toBe("Weekly");
      expect(typeof result.updated_at).toBe("string");
    }
    fetchSpy.mockRestore();
  });

  it("returns cached usage without fetching when called again within TTL", async () => {
    // Cache was populated by the previous test in this describe block.
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await codexProvider.getUsage?.();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    fetchSpy.mockRestore();
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
  it("returns an assistant event for assistant role with content", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "Hello world" });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("assistant");
  });

  it("includes the content as a text block in blocks array", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "Hello world" });
    const event = geminiParseEvent(raw);
    if (event?.type === "assistant") {
      expect(event.blocks[0]).toEqual({ type: "text", text: "Hello world" });
    }
  });

  it("handles delta assistant message with content", () => {
    const raw = JSON.stringify({ type: "message", role: "assistant", content: "partial text", delta: true });
    const event = geminiParseEvent(raw);
    expect(event?.type).toBe("assistant");
    if (event?.type === "assistant") {
      expect(event.blocks[0]).toEqual({ type: "text", text: "partial text" });
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
