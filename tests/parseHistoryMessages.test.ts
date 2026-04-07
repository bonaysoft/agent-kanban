/**
 * Unit tests for parseHistoryMessages (useSessionRelay.ts).
 *
 * Tests cover all SDK message shapes that the function must handle:
 * assistant messages, plain user text (string and array forms),
 * tool_result-only user messages, and mixed user messages that must
 * produce two separate RelayEvents.
 */

import { describe, expect, it } from "vitest";
import { parseHistoryMessages } from "../apps/web/src/hooks/useSessionRelay.js";

// ── Assistant messages ────────────────────────────────────────────────────────

describe("parseHistoryMessages — assistant messages", () => {
  it("produces one RelayEvent of type assistant for an assistant message", () => {
    const messages = [
      {
        type: "assistant",
        uuid: "uuid-1",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("assistant");
  });

  it("uses the message uuid as the event id", () => {
    const messages = [
      {
        type: "assistant",
        uuid: "my-uuid-42",
        message: { content: [{ type: "text", text: "hi" }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events[0].id).toBe("my-uuid-42");
  });

  it("falls back to hist-N id when uuid is absent", () => {
    const messages = [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events[0].id).toMatch(/^hist-\d+$/);
  });

  it("includes text blocks in the assistant event", () => {
    const messages = [
      {
        type: "assistant",
        uuid: "u1",
        message: { content: [{ type: "text", text: "response text" }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const textBlock = evt.blocks.find((b: any) => b.type === "text");
    expect(textBlock?.text).toBe("response text");
  });

  it("includes thinking blocks in the assistant event", () => {
    const messages = [
      {
        type: "assistant",
        uuid: "u1",
        message: { content: [{ type: "thinking", thinking: "I think..." }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const thinkBlock = evt.blocks.find((b: any) => b.type === "thinking");
    expect(thinkBlock?.text).toBe("I think...");
  });

  it("includes tool_use blocks in the assistant event", () => {
    const messages = [
      {
        type: "assistant",
        uuid: "u1",
        message: {
          content: [{ type: "tool_use", id: "tu-1", name: "bash", input: { cmd: "ls" } }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const toolBlock = evt.blocks.find((b: any) => b.type === "tool_use");
    expect(toolBlock?.name).toBe("bash");
  });

  it("skips assistant messages with empty content arrays", () => {
    const messages = [{ type: "assistant", uuid: "u1", message: { content: [] } }];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(0);
  });
});

// ── User messages — plain text (string form) ──────────────────────────────────

describe("parseHistoryMessages — user messages with string content", () => {
  it("produces one RelayEvent of type user for a string content", () => {
    const messages = [{ type: "user", uuid: "u1", message: { content: "hello" } }];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("user");
  });

  it("carries the string text on the user event", () => {
    const messages = [{ type: "user", uuid: "u2", message: { content: "hello there" } }];
    const events = parseHistoryMessages(messages);
    expect((events[0].event as { type: "user"; text: string }).text).toBe("hello there");
  });

  it("uses uuid-user as event id when uuid is present", () => {
    const messages = [{ type: "user", uuid: "abc-123", message: { content: "hi" } }];
    const events = parseHistoryMessages(messages);
    expect(events[0].id).toBe("abc-123-user");
  });

  it("skips whitespace-only string content", () => {
    const messages = [{ type: "user", uuid: "u3", message: { content: "   \n  " } }];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(0);
  });
});

// ── User messages — plain text (array form) ───────────────────────────────────

describe("parseHistoryMessages — user messages with array text blocks", () => {
  it("produces one RelayEvent of type user for an array with a text block", () => {
    const messages = [
      {
        type: "user",
        uuid: "u4",
        message: { content: [{ type: "text", text: "hi from array" }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("user");
  });

  it("carries the text value from the text block", () => {
    const messages = [
      {
        type: "user",
        uuid: "u4",
        message: { content: [{ type: "text", text: "array text" }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect((events[0].event as { type: "user"; text: string }).text).toBe("array text");
  });

  it("joins multiple text blocks with newline", () => {
    const messages = [
      {
        type: "user",
        uuid: "u5",
        message: {
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect((events[0].event as { type: "user"; text: string }).text).toBe("line one\nline two");
  });

  it("skips whitespace-only text blocks in arrays", () => {
    const messages = [
      {
        type: "user",
        uuid: "u6",
        message: { content: [{ type: "text", text: "   " }] },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(0);
  });
});

// ── User messages — tool_result only ─────────────────────────────────────────

describe("parseHistoryMessages — user messages with tool_result only", () => {
  it("produces one RelayEvent of type assistant for a tool_result block", () => {
    const messages = [
      {
        type: "user",
        uuid: "u7",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: "result data" }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(1);
    expect(events[0].event.type).toBe("assistant");
  });

  it("uses uuid-tool as event id for the tool_result event", () => {
    const messages = [
      {
        type: "user",
        uuid: "tool-uuid",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    expect(events[0].id).toBe("tool-uuid-tool");
  });

  it("includes a tool_result block in the assistant event blocks", () => {
    const messages = [
      {
        type: "user",
        uuid: "u8",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool-id-5", content: "output here" }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const toolResult = evt.blocks.find((b: any) => b.type === "tool_result");
    expect(toolResult?.tool_use_id).toBe("tool-id-5");
  });

  it("handles tool_result with array content by joining text parts", () => {
    const messages = [
      {
        type: "user",
        uuid: "u9",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-2",
              content: [
                { type: "text", text: "part 1" },
                { type: "text", text: "part 2" },
              ],
            },
          ],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const toolResult = evt.blocks.find((b: any) => b.type === "tool_result");
    expect(toolResult?.output).toBe("part 1\npart 2");
  });

  it("produces undefined output when tool_result content is neither string nor array", () => {
    const messages = [
      {
        type: "user",
        uuid: "u-null",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu-null", content: null }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const toolResult = evt.blocks.find((b: any) => b.type === "tool_result");
    expect(toolResult?.output).toBeUndefined();
  });

  it("maps is_error flag to error property on tool_result", () => {
    const messages = [
      {
        type: "user",
        uuid: "u10",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu-3", content: "err", is_error: true }],
        },
      },
    ];
    const events = parseHistoryMessages(messages);
    const evt = events[0].event as { type: "assistant"; blocks: any[] };
    const toolResult = evt.blocks.find((b: any) => b.type === "tool_result");
    expect(toolResult?.error).toBe(true);
  });
});

// ── User messages — mixed tool_result AND text ────────────────────────────────

describe("parseHistoryMessages — user messages with both tool_result and text", () => {
  function mixedMessage() {
    return [
      {
        type: "user",
        uuid: "mixed-uuid",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu-99", content: "tool output" },
            { type: "text", text: "user follow-up" },
          ],
        },
      },
    ];
  }

  it("produces two RelayEvents for a message with both tool_result and text", () => {
    const events = parseHistoryMessages(mixedMessage());
    expect(events).toHaveLength(2);
  });

  it("first event has type assistant (the tool_result)", () => {
    const events = parseHistoryMessages(mixedMessage());
    expect(events[0].event.type).toBe("assistant");
  });

  it("second event has type user (the plain text)", () => {
    const events = parseHistoryMessages(mixedMessage());
    expect(events[1].event.type).toBe("user");
  });

  it("tool_result event id ends with -tool suffix", () => {
    const events = parseHistoryMessages(mixedMessage());
    expect(events[0].id).toBe("mixed-uuid-tool");
  });

  it("user text event id ends with -user suffix", () => {
    const events = parseHistoryMessages(mixedMessage());
    expect(events[1].id).toBe("mixed-uuid-user");
  });

  it("two ids are distinct", () => {
    const events = parseHistoryMessages(mixedMessage());
    expect(events[0].id).not.toBe(events[1].id);
  });

  it("user text event carries the correct text", () => {
    const events = parseHistoryMessages(mixedMessage());
    const userEvt = events[1].event as { type: "user"; text: string };
    expect(userEvt.text).toBe("user follow-up");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("parseHistoryMessages — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(parseHistoryMessages([])).toEqual([]);
  });

  it("skips messages with unknown type", () => {
    const messages = [{ type: "system", message: { content: "ignored" } }];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(0);
  });

  it("each event has a timestamp string", () => {
    const messages = [{ type: "assistant", uuid: "u1", message: { content: [{ type: "text", text: "hi" }] } }];
    const events = parseHistoryMessages(messages);
    expect(typeof events[0].timestamp).toBe("string");
    expect(events[0].timestamp.length).toBeGreaterThan(0);
  });

  it("processes multiple messages in order", () => {
    const messages = [
      { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "first" }] } },
      { type: "user", uuid: "u1", message: { content: "second" } },
      { type: "assistant", uuid: "a2", message: { content: [{ type: "text", text: "third" }] } },
    ];
    const events = parseHistoryMessages(messages);
    expect(events).toHaveLength(3);
    expect(events[0].event.type).toBe("assistant");
    expect(events[1].event.type).toBe("user");
    expect(events[2].event.type).toBe("assistant");
  });
});
