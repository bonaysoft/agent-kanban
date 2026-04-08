import { type AppendMessage, AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from "@assistant-ui/react";
import { type ReactNode, useCallback, useMemo } from "react";
import type { AgentStatus, RelayEvent } from "../hooks/useSessionRelay";
import { useSessionRelay } from "../hooks/useSessionRelay";

// ─── Event → Message Conversion ───

type ContentPart = { type: "text"; text: string } | { type: "reasoning"; text: string } | ToolCallPart;

type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
};

export function convertEvents(events: RelayEvent[], agentStatus: AgentStatus): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  const toolCallMap = new Map<string, ToolCallPart>();

  // Current assistant message being built (streaming turn or legacy accumulation)
  let currentParts: ContentPart[] = [];
  let currentId: string | null = null;
  let currentTimestamp: string | null = null;
  let turnRunning = false;

  function flushAssistant(status: ThreadMessageLike["status"]) {
    // Only create a message if there are content parts to flush
    if (currentParts.length === 0) return;

    messages.push({
      id: currentId!,
      role: "assistant",
      content: currentParts as ThreadMessageLike["content"],
      createdAt: new Date(currentTimestamp!),
      status,
    });

    // Reset state for next message
    currentParts = [];
    currentId = null;
    currentTimestamp = null;
    turnRunning = false;
  }

  function ensureCurrentTurn(re: RelayEvent) {
    // Initialize turn state if this is the first event in the turn
    if (!currentId) {
      currentId = re.id;
      currentTimestamp = re.timestamp;
    }
  }

  function mapBlock(block: { type: string; [k: string]: any }): ContentPart | null {
    switch (block.type) {
      case "thinking":
        return { type: "reasoning", text: block.text ?? "" };
      case "tool_use": {
        const tc: ToolCallPart = {
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          args: block.input ?? {},
        };
        toolCallMap.set(block.id, tc);
        return tc;
      }
      case "text":
        return { type: "text", text: block.text ?? "" };
      default:
        return null;
    }
  }

  function updateOrAppend(block: { type: string; [k: string]: any }) {
    if (block.type === "tool_result") {
      const tc = toolCallMap.get(block.tool_use_id);
      if (tc) {
        tc.result = block.error ? { error: block.output ?? "Unknown error" } : (block.output ?? "Done");
      }
      return;
    }

    // For text/thinking/tool_use done events: find an existing part to update, or append
    if (block.type === "tool_use") {
      const existing = toolCallMap.get(block.id);
      if (existing) {
        // Update with final args
        existing.args = block.input ?? existing.args;
        return;
      }
    }

    // For thinking/text blocks, find the last empty part of the same type
    const targetType = block.type === "thinking" ? "reasoning" : block.type;
    if (targetType === "reasoning" || targetType === "text") {
      // Search backwards more efficiently - early exit when found
      for (let i = currentParts.length - 1; i >= 0; i--) {
        const p = currentParts[i];
        if (p.type === targetType && p.text === "") {
          p.text = block.text ?? "";
          return;
        }
        // Stop searching if we hit a different type (parts are added in order)
        if (p.type !== targetType) break;
      }
    }

    // Fallback: append as new part
    const part = mapBlock(block);
    if (part) currentParts.push(part);
  }

  for (const re of events) {
    const { event } = re;

    // ── Streaming turn lifecycle ──

    if (event.type === "turn.start") {
      flushAssistant({ type: "complete", reason: "unknown" });
      currentId = re.id;
      currentTimestamp = re.timestamp;
      turnRunning = true;
      continue;
    }

    if (event.type === "block.start") {
      ensureCurrentTurn(re);
      turnRunning = true;
      const part = mapBlock(event.block);
      if (part) currentParts.push(part);
      continue;
    }

    if (event.type === "block.done") {
      ensureCurrentTurn(re);
      updateOrAppend(event.block);
      continue;
    }

    // ── Legacy events (history, Gemini) ──

    if (event.type === "message.user") {
      flushAssistant({ type: "complete", reason: "unknown" });
      messages.push({
        id: re.id,
        role: "user",
        content: [{ type: "text", text: event.text }],
        createdAt: new Date(re.timestamp),
      });
      continue;
    }

    if (event.type === "message") {
      ensureCurrentTurn(re);
      for (const block of event.blocks) {
        if (block.type === "tool_result") {
          const tc = toolCallMap.get(block.tool_use_id);
          if (tc) {
            tc.result = block.error ? { error: block.output ?? "Unknown error" } : (block.output ?? "Done");
          }
        } else {
          const part = mapBlock(block);
          if (part) currentParts.push(part);
        }
      }
      continue;
    }

    // ── Turn terminal events ──

    if (event.type === "turn.end") {
      flushAssistant({ type: "complete", reason: "unknown" });
      if (event.text || event.cost != null) {
        messages.push({
          id: re.id,
          role: "assistant",
          content: [
            {
              type: "text",
              text: event.text
                ? `Done${event.cost != null ? ` ($${event.cost.toFixed(4)})` : ""} — ${event.text.slice(0, 120)}`
                : `Done${event.cost != null ? ` ($${event.cost.toFixed(4)})` : ""}`,
            },
          ],
          createdAt: new Date(re.timestamp),
          status: { type: "complete", reason: "stop" },
        });
      }
      continue;
    }

    if (event.type === "turn.error") {
      flushAssistant({ type: "complete", reason: "unknown" });
      messages.push({
        id: re.id,
        role: "assistant",
        content: [{ type: "text", text: `Error: ${event.detail}` }],
        createdAt: new Date(re.timestamp),
        status: { type: "incomplete", reason: "error" },
      });
      continue;
    }

    if (event.type === "turn.rate_limit" && event.status === "rejected") {
      flushAssistant({ type: "complete", reason: "unknown" });
      const detail = event.isUsingOverage
        ? "continuing on extra usage"
        : event.resetAt
          ? `resets at ${new Date(event.resetAt).toLocaleTimeString()}`
          : "reset time unknown";
      messages.push({
        id: re.id,
        role: "assistant",
        content: [{ type: "text", text: `Rate limited — ${detail}` }],
        createdAt: new Date(re.timestamp),
        status: { type: "incomplete", reason: "error" },
      });
    }
  }

  // Flush remaining parts — running if turn is open or agent is working
  const isRunning = turnRunning || agentStatus === "working";
  flushAssistant(isRunning ? { type: "running" } : { type: "complete", reason: "unknown" });

  return messages;
}

// ─── Provider ───

interface RelayRuntimeProviderProps {
  sessionId: string | null;
  userId: string | null;
  taskDone: boolean;
  children: ReactNode;
}

export function RelayRuntimeProvider({ sessionId, userId, taskDone, children }: RelayRuntimeProviderProps) {
  const { events, sendMessage, daemonConnected, agentStatus } = useSessionRelay({
    sessionId,
    enabled: !!sessionId,
  });

  const messages = useMemo(() => convertEvents(events, agentStatus), [events, agentStatus]);

  const isRunning = agentStatus === "working" && !taskDone;

  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (!userId || !daemonConnected) {
        throw new Error("Cannot send: agent not connected");
      }
      const textPart = message.content.find((p) => p.type === "text");
      if (!textPart || textPart.type !== "text") return;
      sendMessage(textPart.text, userId);
    },
    [userId, daemonConnected, sendMessage],
  );

  const convertMessage = useCallback((message: ThreadMessageLike): ThreadMessageLike => message, []);

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage,
    onNew,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
