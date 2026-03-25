import { describe, expect, it } from "vitest";
import { claudeProvider } from "../src/providers/claude.js";

describe("claudeProvider", () => {
  describe("identity", () => {
    it("has name 'claude'", () => {
      expect(claudeProvider.name).toBe("claude");
    });

    it("has label 'Claude Code'", () => {
      expect(claudeProvider.label).toBe("Claude Code");
    });

    it("has command 'claude'", () => {
      expect(claudeProvider.command).toBe("claude");
    });
  });

  describe("buildArgs", () => {
    it("returns required flags", () => {
      const args = claudeProvider.buildArgs({ sessionId: "sess-1" });
      expect(args).toContain("--print");
      expect(args).toContain("--verbose");
      expect(args).toContain("--input-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--output-format");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("includes session-id flag and value", () => {
      const args = claudeProvider.buildArgs({ sessionId: "my-session" });
      const idx = args.indexOf("--session-id");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe("my-session");
    });

    it("does not include system-prompt-file when not provided", () => {
      const args = claudeProvider.buildArgs({ sessionId: "sess-1" });
      expect(args).not.toContain("--system-prompt-file");
    });

    it("includes system-prompt-file when provided", () => {
      const args = claudeProvider.buildArgs({ sessionId: "sess-1", systemPromptFile: "/tmp/prompt.txt" });
      const idx = args.indexOf("--system-prompt-file");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe("/tmp/prompt.txt");
    });
  });

  describe("buildResumeArgs", () => {
    it("starts with --resume and session id", () => {
      const args = claudeProvider.buildResumeArgs("resume-id");
      expect(args[0]).toBe("--resume");
      expect(args[1]).toBe("resume-id");
    });

    it("includes required streaming flags", () => {
      const args = claudeProvider.buildResumeArgs("resume-id");
      expect(args).toContain("--print");
      expect(args).toContain("--verbose");
      expect(args).toContain("--input-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--output-format");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("does not include --session-id flag", () => {
      const args = claudeProvider.buildResumeArgs("resume-id");
      expect(args).not.toContain("--session-id");
    });
  });

  describe("parseEvent", () => {
    it("returns null for invalid JSON", () => {
      expect(claudeProvider.parseEvent("not-json")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(claudeProvider.parseEvent("")).toBeNull();
    });

    it("returns null for unrecognized event type", () => {
      expect(claudeProvider.parseEvent(JSON.stringify({ type: "unknown" }))).toBeNull();
    });

    it("returns rate_limit for rate_limit_event with blocked status", () => {
      const raw = JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "blocked", resetsAt: 1700000000 },
      });
      const event = claudeProvider.parseEvent(raw);
      expect(event?.type).toBe("rate_limit");
      if (event?.type === "rate_limit") {
        expect(event.resetAt).toBe(new Date(1700000000 * 1000).toISOString());
      }
    });

    it("returns null for rate_limit_event with allowed status", () => {
      const raw = JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", resetsAt: 1700000000 },
      });
      expect(claudeProvider.parseEvent(raw)).toBeNull();
    });

    it("returns null for rate_limit_event with no rate_limit_info", () => {
      const raw = JSON.stringify({ type: "rate_limit_event" });
      expect(claudeProvider.parseEvent(raw)).toBeNull();
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

    it("returns error event for generic error type", () => {
      const raw = JSON.stringify({
        type: "error",
        error: { type: "server_error", message: "Something went wrong" },
      });
      const event = claudeProvider.parseEvent(raw);
      expect(event?.type).toBe("error");
      if (event?.type === "error") {
        expect(event.code).toBe("server_error");
        expect(event.detail).toBe("Something went wrong");
      }
    });

    it("returns error event with detail from error.message when no code", () => {
      const raw = JSON.stringify({
        type: "error",
        error: { message: "plain error" },
      });
      const event = claudeProvider.parseEvent(raw);
      expect(event?.type).toBe("error");
      if (event?.type === "error") {
        expect(event.detail).toBe("plain error");
      }
    });

    it("returns message event for assistant event with text content", () => {
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

    it("returns null for assistant event with no text blocks", () => {
      const raw = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tu_1" }] },
      });
      expect(claudeProvider.parseEvent(raw)).toBeNull();
    });

    it("returns null for assistant event with empty content array", () => {
      const raw = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      });
      expect(claudeProvider.parseEvent(raw)).toBeNull();
    });

    it("returns result event with cost and usage", () => {
      const raw = JSON.stringify({
        type: "result",
        total_cost_usd: 0.005,
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const event = claudeProvider.parseEvent(raw);
      expect(event?.type).toBe("result");
      if (event?.type === "result") {
        expect(event.cost).toBe(0.005);
        expect(event.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
      }
    });

    it("returns result event with undefined cost when not present", () => {
      const raw = JSON.stringify({ type: "result" });
      const event = claudeProvider.parseEvent(raw);
      expect(event?.type).toBe("result");
      if (event?.type === "result") {
        expect(event.cost).toBeUndefined();
        expect(event.usage).toBeUndefined();
      }
    });

    it("extracts error detail from assistant message text block when event has error field", () => {
      const raw = JSON.stringify({
        type: "assistant",
        error: { type: "some_error", message: "fallback" },
        message: {
          content: [{ type: "text", text: "Error from content" }],
        },
      });
      const event = claudeProvider.parseEvent(raw);
      expect(event?.type).toBe("error");
      if (event?.type === "error") {
        expect(event.detail).toBe("Error from content");
      }
    });
  });

  describe("buildInput", () => {
    it("returns valid JSON string", () => {
      const input = claudeProvider.buildInput("do the thing");
      expect(() => JSON.parse(input)).not.toThrow();
    });

    it("wraps task context in user message structure", () => {
      const input = claudeProvider.buildInput("my task context");
      const parsed = JSON.parse(input);
      expect(parsed.type).toBe("user");
      expect(parsed.message.role).toBe("user");
      expect(parsed.message.content).toBe("my task context");
    });

    it("preserves task context verbatim", () => {
      const ctx = "context with special chars: <>&\"'";
      const parsed = JSON.parse(claudeProvider.buildInput(ctx));
      expect(parsed.message.content).toBe(ctx);
    });
  });
});
