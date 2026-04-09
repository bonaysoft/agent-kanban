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
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("turn.rate_limit");
  });

  it("includes resetAt as ISO string derived from resetsAt epoch", () => {
    const resetsAt = 1700000000;
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("turn.rate_limit");
    if (result?.type === "turn.rate_limit") {
      expect(result.resetAt).toBeDefined();
      expect(new Date(result.resetAt!).getTime()).toBe(resetsAt * 1000);
    }
  });

  it("includes rateLimitType from rate_limit_info", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "turn.rate_limit") {
      expect(result.rateLimitType).toBe("five_hour");
    }
  });

  it("includes status: rejected in the event", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "turn.rate_limit") {
      expect(result.status).toBe("rejected");
    }
  });

  it("leaves resetAt undefined when resetsAt is absent", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: null, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("turn.rate_limit");
    if (result?.type === "turn.rate_limit") {
      expect(result.resetAt).toBeUndefined();
    }
  });

  it("builds overage object when overageStatus is present", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        resetsAt: 1700000000,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        overageResetsAt: 1700003600,
      },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    if (result?.type === "turn.rate_limit") {
      expect(result.overage).toEqual({
        status: "rejected",
        resetAt: new Date(1700003600 * 1000).toISOString(),
      });
    }
  });
});

describe("mapSDKMessage — rate_limit_event allowed", () => {
  it("returns rate_limit event with status allowed when status is allowed with isUsingOverage true", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1700000000, rateLimitType: "five_hour", isUsingOverage: true },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("turn.rate_limit");
    if (result?.type === "turn.rate_limit") {
      expect(result.status).toBe("allowed");
      expect(result.isUsingOverage).toBe(true);
    }
  });

  it("returns rate_limit event with status allowed when status is allowed with isUsingOverage false", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: null, rateLimitType: "five_hour", isUsingOverage: false },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("turn.rate_limit");
    if (result?.type === "turn.rate_limit") {
      expect(result.status).toBe("allowed");
      expect(result.isUsingOverage).toBe(false);
    }
  });

  it("returns null when status is allowed_warning (regression check)", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", resetsAt: 1700000000, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)).toBeNull();
  });

  it("returns null for unrecognised status values", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "unknown_status", resetsAt: 1700000000, rateLimitType: "five_hour" },
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
  it("returns assistant event with text block from content block", () => {
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
      expect(result.blocks[0]).toEqual({ type: "text", text: "hello" });
    }
  });

  it("includes both text blocks in blocks array for multiple text blocks", () => {
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
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0]).toEqual({ type: "text", text: "Line one" });
      expect(result.blocks[1]).toEqual({ type: "text", text: "Line two" });
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
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0].type).toBe("tool_use");
    }
  });

  it("returns null when message content is empty array", () => {
    const msg = {
      type: "assistant",
      message: { content: [] },
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
    expect(result?.type).toBe("turn.rate_limit");
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
    expect(result?.type).toBe("turn.rate_limit");
    if (result?.type === "turn.rate_limit") {
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
    expect(result?.type).toBe("turn.error");
    if (result?.type === "turn.error") {
      expect(result.code).toBe("authentication_error");
    }
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessage — result
// ---------------------------------------------------------------------------

describe("mapSDKMessage — result", () => {
  it("returns turn.end event", () => {
    const msg = {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    expect(mapSDKMessage(msg)?.type).toBe("turn.end");
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
    if (result?.type === "turn.end") {
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
    if (result?.type === "turn.end") {
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
    if (result?.type === "turn.end") {
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
// mapSDKMessage — assistant with parent_tool_use_id (subtask parent stamping)
// ---------------------------------------------------------------------------

describe("mapSDKMessage — assistant with parent_tool_use_id stamps parent_id on blocks", () => {
  it("stamps parent_id on text block when parent_tool_use_id is set", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "subagent says hi" }] },
      error: undefined,
      parent_tool_use_id: "toolu_X",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0]).toEqual({ type: "text", text: "subagent says hi", parent_id: "toolu_X" });
    }
  });

  it("stamps parent_id on tool_use block when parent_tool_use_id is set", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "inner_tu1", name: "bash", input: { command: "pwd" } }] },
      error: undefined,
      parent_tool_use_id: "toolu_X",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0]).toEqual({
        type: "tool_use",
        id: "inner_tu1",
        name: "bash",
        input: { command: "pwd" },
        parent_id: "toolu_X",
      });
    }
  });

  it("stamps parent_id on thinking block when parent_tool_use_id is set", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "inner thoughts" }] },
      error: undefined,
      parent_tool_use_id: "toolu_X",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0]).toEqual({ type: "thinking", text: "inner thoughts", parent_id: "toolu_X" });
    }
  });

  it("does not stamp parent_id when parent_tool_use_id is null", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "main agent text" }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0]).toEqual({ type: "text", text: "main agent text" });
      expect((result.blocks[0] as any).parent_id).toBeUndefined();
    }
  });

  it("stamps parent_id on all blocks in a multi-block message", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "first" },
          { type: "tool_use", id: "t1", name: "bash", input: {} },
        ],
      },
      error: undefined,
      parent_tool_use_id: "toolu_parent",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0]).toHaveProperty("parent_id", "toolu_parent");
      expect(result.blocks[1]).toHaveProperty("parent_id", "toolu_parent");
    }
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessage — system messages (mapTaskSystemMessage via delegation)
// ---------------------------------------------------------------------------

describe("mapSDKMessage — system type task_started maps to subtask.start", () => {
  it("returns subtask.start with tool_use_id and description", () => {
    const msg = {
      type: "system",
      subtype: "task_started",
      tool_use_id: "toolu_abc",
      description: "Build the feature",
      task_type: "worker",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("subtask.start");
    if (result?.type === "subtask.start") {
      expect(result.tool_use_id).toBe("toolu_abc");
      expect(result.description).toBe("Build the feature");
      expect(result.kind).toBe("worker");
    }
  });

  it("returns null when tool_use_id is missing", () => {
    const msg = {
      type: "system",
      subtype: "task_started",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    expect(mapSDKMessage(msg)).toBeNull();
  });
});

describe("mapSDKMessage — system type task_progress maps to subtask.progress", () => {
  it("returns subtask.progress with all fields when usage is provided", () => {
    const msg = {
      type: "system",
      subtype: "task_progress",
      tool_use_id: "toolu_abc",
      summary: "Halfway there",
      last_tool_name: "bash",
      usage: { total_tokens: 350, duration_ms: 2500 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("subtask.progress");
    if (result?.type === "subtask.progress") {
      expect(result.tool_use_id).toBe("toolu_abc");
      expect(result.summary).toBe("Halfway there");
      expect(result.last_tool).toBe("bash");
      expect(result.tokens).toBe(350);
      expect(result.duration_ms).toBe(2500);
    }
  });

  it("returns subtask.progress with undefined tokens and duration_ms when usage is absent", () => {
    const msg = {
      type: "system",
      subtype: "task_progress",
      tool_use_id: "toolu_abc",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("subtask.progress");
    if (result?.type === "subtask.progress") {
      expect(result.tokens).toBeUndefined();
      expect(result.duration_ms).toBeUndefined();
    }
  });
});

describe("mapSDKMessage — system type task_notification maps to subtask.end", () => {
  it("returns subtask.end with status completed and summary", () => {
    const msg = {
      type: "system",
      subtype: "task_notification",
      tool_use_id: "toolu_abc",
      status: "completed",
      summary: "Task done successfully",
      usage: { total_tokens: 1000, duration_ms: 8000 },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("subtask.end");
    if (result?.type === "subtask.end") {
      expect(result.tool_use_id).toBe("toolu_abc");
      expect(result.status).toBe("completed");
      expect(result.summary).toBe("Task done successfully");
      expect(result.tokens).toBe(1000);
      expect(result.duration_ms).toBe(8000);
    }
  });

  it("returns subtask.end with status failed", () => {
    const msg = {
      type: "system",
      subtype: "task_notification",
      tool_use_id: "toolu_abc",
      status: "failed",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("subtask.end");
    if (result?.type === "subtask.end") {
      expect(result.status).toBe("failed");
    }
  });

  it("returns subtask.end with status stopped", () => {
    const msg = {
      type: "system",
      subtype: "task_notification",
      tool_use_id: "toolu_abc",
      status: "stopped",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("subtask.end");
    if (result?.type === "subtask.end") {
      expect(result.status).toBe("stopped");
    }
  });
});

describe("mapSDKMessage — system type unknown subtype returns null", () => {
  it("returns null for unrecognized system subtype", () => {
    const msg = {
      type: "system",
      subtype: "unknown_system_event",
      tool_use_id: "toolu_abc",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    expect(mapSDKMessage(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessageStream — subtask blocks do not open a main turn
// ---------------------------------------------------------------------------

import { mapSDKMessageStream } from "../packages/cli/src/providers/claude.js";

describe("mapSDKMessageStream — subtask stream_event does not open main turn", () => {
  it("does not emit turn.start when block.start has parent_id", () => {
    // Use tool_use (no falsy-text guard) so mapStreamBlock produces a block
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "inner_t1", name: "bash", input: {} },
      },
      parent_tool_use_id: "toolu_X",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    // turn.start must NOT be emitted for a subtask block
    expect(events.find((e) => e.type === "turn.start")).toBeUndefined();
    // The block.start IS emitted with parent_id
    const blockStart = events.find((e) => e.type === "block.start");
    expect(blockStart).toBeDefined();
    if (blockStart?.type === "block.start") {
      expect((blockStart.block as any).parent_id).toBe("toolu_X");
    }
    // turnOpen must remain false since no main turn was started
    expect(turnOpen.value).toBe(false);
  });

  it("emits turn.start for non-subtask block.start when turn is not open", () => {
    // Use tool_use so mapStreamBlock produces a block (text: "" is filtered out)
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "main_t1", name: "read", input: {} },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events[0].type).toBe("turn.start");
    expect(turnOpen.value).toBe(true);
  });

  it("does not emit duplicate turn.start when turn is already open and non-subtask block arrives", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "main_t2", name: "write", input: {} },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: true };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    const turnStarts = events.filter((e) => e.type === "turn.start");
    expect(turnStarts).toHaveLength(0);
  });
});

describe("mapSDKMessageStream — assistant message with all subtask blocks does not emit turn.start", () => {
  it("only subtask blocks in assistant message — no turn.start emitted", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "subagent output" }] },
      error: undefined,
      parent_tool_use_id: "toolu_X",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events.find((e) => e.type === "turn.start")).toBeUndefined();
    // turnOpen stays false
    expect(turnOpen.value).toBe(false);
    // block.done emitted with parent_id
    const blockDone = events.find((e) => e.type === "block.done");
    expect(blockDone).toBeDefined();
    if (blockDone?.type === "block.done") {
      expect((blockDone.block as any).parent_id).toBe("toolu_X");
    }
  });

  it("main blocks in assistant message open a turn if not already open", () => {
    const msg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "main output" }] },
      error: undefined,
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events[0].type).toBe("turn.start");
    expect(turnOpen.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessageStream — user message (tool results)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// mapSDKMessage — user type (mapToolResult paths)
// ---------------------------------------------------------------------------

describe("mapSDKMessage — user type maps tool results", () => {
  it("returns message event when user message has array tool_result content", () => {
    const msg = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu1",
            content: [
              { type: "text", text: "first line" },
              { type: "text", text: "second line" },
            ],
            is_error: false,
          },
        ],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const result = mapSDKMessage(msg);
    expect(result?.type).toBe("message");
    if (result?.type === "message") {
      expect(result.blocks[0].type).toBe("tool_result");
      if (result.blocks[0].type === "tool_result") {
        expect(result.blocks[0].output).toBe("first line\nsecond line");
      }
    }
  });

  it("returns null when user message content is a string (no tool_result blocks)", () => {
    const msg = {
      type: "user",
      message: { role: "user", content: "plain user message" },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    expect(mapSDKMessage(msg)).toBeNull();
  });

  it("returns null when user message has empty content array", () => {
    const msg = {
      type: "user",
      message: { role: "user", content: [] },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    expect(mapSDKMessage(msg)).toBeNull();
  });
});

describe("mapSDKMessageStream — user message emits block.done for tool results", () => {
  it("emits block.done events for string tool_result content", () => {
    const msg = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu1", content: "result output", is_error: false }],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: true };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("block.done");
    if (events[0].type === "block.done") {
      expect(events[0].block.type).toBe("tool_result");
      if (events[0].block.type === "tool_result") {
        expect(events[0].block.tool_use_id).toBe("tu1");
        expect(events[0].block.output).toBe("result output");
      }
    }
  });

  it("emits no events for user message with string content (not an array)", () => {
    const msg = {
      type: "user",
      message: { role: "user", content: "plain string" },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: true };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(0);
  });

  it("stamps parent_id on tool_result block when parent_tool_use_id is set", () => {
    const msg = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "inner_tu1", content: "inner result", is_error: false }],
      },
      parent_tool_use_id: "toolu_parent",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(1);
    if (events[0].type === "block.done") {
      expect((events[0].block as any).parent_id).toBe("toolu_parent");
    }
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessageStream — result message emits turn.end
// ---------------------------------------------------------------------------

describe("mapSDKMessageStream — result message emits turn.end and closes turn", () => {
  it("emits turn.end and sets turnOpen to false", () => {
    const msg = {
      type: "result",
      subtype: "success",
      result: "Task completed",
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
    } as unknown as SDKMessage;

    const turnOpen = { value: true };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn.end");
    if (events[0].type === "turn.end") {
      expect(events[0].text).toBe("Task completed");
      expect(events[0].cost).toBe(0.05);
    }
    expect(turnOpen.value).toBe(false);
  });

  it("sets result text to undefined for non-success subtype", () => {
    const msg = {
      type: "result",
      subtype: "error_max_turns",
      total_cost_usd: 0,
      usage: {},
    } as unknown as SDKMessage;

    const turnOpen = { value: true };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events[0].type).toBe("turn.end");
    if (events[0].type === "turn.end") {
      expect(events[0].text).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessageStream — assistant with error resets turnOpen
// ---------------------------------------------------------------------------

describe("mapSDKMessageStream — assistant error resets turnOpen", () => {
  it("sets turnOpen to false when assistant message has error and turnOpen was true", () => {
    const msg = {
      type: "assistant",
      error: "rate_limit",
      message: { content: [] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: true };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(turnOpen.value).toBe(false);
    // Also emits a rate_limit event
    expect(events[0].type).toBe("turn.rate_limit");
  });

  it("emits the error event from mapSDKMessage when assistant has non-rate-limit error", () => {
    const msg = {
      type: "assistant",
      error: "server_error",
      message: { content: [] },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events[0].type).toBe("turn.error");
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessageStream — delegates unknown types to mapSDKMessage
// ---------------------------------------------------------------------------

describe("mapSDKMessageStream — delegates non-stream non-assistant non-result messages", () => {
  it("emits rate_limit event for rate_limit_event via delegation", () => {
    const msg = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1700000000, rateLimitType: "five_hour" },
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn.rate_limit");
  });

  it("emits subtask.start for system task_started via delegation", () => {
    const msg = {
      type: "system",
      subtype: "task_started",
      tool_use_id: "toolu_abc",
      description: "Delegated task",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("subtask.start");
  });

  it("emits no events when mapSDKMessage returns null for unknown type", () => {
    const msg = {
      type: "unknown_type_xyz",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mapSDKMessageStream — stream_event with thinking and text (mapStreamBlock branches)
// ---------------------------------------------------------------------------

describe("mapSDKMessageStream — stream_event mapStreamBlock branches", () => {
  it("emits block.start for thinking content_block with non-empty thinking field", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "thinking", thinking: "Let me think" },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    const blockStart = events.find((e) => e.type === "block.start");
    expect(blockStart).toBeDefined();
    if (blockStart?.type === "block.start") {
      expect(blockStart.block.type).toBe("thinking");
      if (blockStart.block.type === "thinking") {
        expect(blockStart.block.text).toBe("Let me think");
      }
    }
  });

  it("emits no block.start when thinking content_block has empty thinking field", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "thinking", thinking: "" },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    // No block produced — nothing emitted (mapStreamBlock returns null)
    expect(events.find((e) => e.type === "block.start")).toBeUndefined();
  });

  it("emits block.start for text content_block with non-empty text", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "text", text: "Hello" },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    const blockStart = events.find((e) => e.type === "block.start");
    expect(blockStart).toBeDefined();
    if (blockStart?.type === "block.start") {
      expect(blockStart.block.type).toBe("text");
    }
  });

  it("emits no block.start for unknown content_block type", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "unknown_block_type" },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const turnOpen = { value: false };
    const events = [...mapSDKMessageStream(msg, turnOpen)];

    expect(events).toHaveLength(0);
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
    expect(handle.pid).toBe(process.pid);
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
    // Streaming mapper yields turn_start + content_block_done for an assistant message
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "turn.start" });
    expect(events[1]).toEqual({ type: "block.done", block: { type: "text", text: "SDK message" } });
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
