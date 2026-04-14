// @vitest-environment node
/**
 * Unit tests for getClaudeHistory (claude.ts).
 *
 * getClaudeHistory calls getSessionMessages from the SDK and maps each
 * message through mapSDKMessage. The SDK is mocked so no real Claude session
 * is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Suppress child_process and fs calls from readOAuthToken ──────────────────
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockImplementation(() => {
    throw new Error("not available in tests");
  }),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockImplementation(() => {
    throw new Error("ENOENT");
  }),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, platform: vi.fn().mockReturnValue("linux"), homedir: actual.homedir };
});

vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Mock the SDK ──────────────────────────────────────────────────────────────
const mockGetSessionMessages = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {},
    close: vi.fn(),
    streamInput: vi.fn().mockResolvedValue(undefined),
  }),
  getSessionMessages: (...args: any[]) => mockGetSessionMessages(...args),
}));

import { getClaudeHistory } from "../packages/cli/src/providers/claude.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assistantMsg(text: string, uuid = "uuid-1") {
  return {
    type: "assistant",
    uuid,
    parent_tool_use_id: null,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function resultMsg(cost = 0.01) {
  return {
    type: "result",
    subtype: "success",
    result: "done",
    total_cost_usd: cost,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getClaudeHistory — basic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when SDK returns no messages", async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    const events = await getClaudeHistory("session-1");
    expect(events).toEqual([]);
  });

  it("filters out messages that mapSDKMessage returns null for", async () => {
    // system messages with unknown subtype → mapSDKMessage returns null
    mockGetSessionMessages.mockResolvedValue([{ type: "system", subtype: "unknown_thing", tool_use_id: null }]);
    const events = await getClaudeHistory("session-2");
    expect(events).toHaveLength(0);
  });

  it("returns one event for a single assistant message", async () => {
    mockGetSessionMessages.mockResolvedValue([assistantMsg("Hello")]);
    const events = await getClaudeHistory("session-3");
    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("message");
  });

  it("uses uuid from SessionMessage as event id", async () => {
    mockGetSessionMessages.mockResolvedValue([assistantMsg("A"), assistantMsg("B", "uuid-2")]);
    const events = await getClaudeHistory("session-4");
    expect(events[0].id).toBe("uuid-1");
    expect(events[1].id).toBe("uuid-2");
  });

  it("assigns a timestamp ISO string to each event", async () => {
    mockGetSessionMessages.mockResolvedValue([assistantMsg("A")]);
    const events = await getClaudeHistory("session-5");
    expect(() => new Date(events[0].timestamp)).not.toThrow();
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("maps a result message to turn.end event", async () => {
    mockGetSessionMessages.mockResolvedValue([resultMsg(0.05)]);
    const events = await getClaudeHistory("session-6");
    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("turn.end");
    if (events[0].event.type === "turn.end") {
      expect(events[0].event.cost).toBe(0.05);
    }
  });

  it("returns multiple events for a mixed message list", async () => {
    mockGetSessionMessages.mockResolvedValue([assistantMsg("First"), assistantMsg("Second", "uuid-2"), resultMsg()]);
    const events = await getClaudeHistory("session-7");
    expect(events).toHaveLength(3);
    expect(events[0].event.type).toBe("message");
    expect(events[1].event.type).toBe("message");
    expect(events[2].event.type).toBe("turn.end");
  });

  it("calls getSessionMessages with the provided sessionId", async () => {
    mockGetSessionMessages.mockResolvedValue([]);
    await getClaudeHistory("my-session-id");
    expect(mockGetSessionMessages).toHaveBeenCalledWith("my-session-id");
  });
});
