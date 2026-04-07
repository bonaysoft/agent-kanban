import { type AppendMessage, AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from "@assistant-ui/react";
import { type ReactNode, useCallback, useMemo } from "react";
import type { RelayEvent } from "../hooks/useSessionRelay";
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

function convertEvents(events: RelayEvent[]): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  const toolCallMap = new Map<string, ToolCallPart>();

  for (const re of events) {
    const { event } = re;

    if (event.type === "user") {
      messages.push({
        id: re.id,
        role: "user",
        content: [{ type: "text", text: event.text }],
        createdAt: new Date(re.timestamp),
      });
      continue;
    }

    if (event.type === "assistant") {
      const parts: ContentPart[] = [];

      for (const block of event.blocks) {
        switch (block.type) {
          case "thinking":
            parts.push({ type: "reasoning", text: block.text });
            break;
          case "tool_use": {
            const tc: ToolCallPart = {
              type: "tool-call",
              toolCallId: block.id,
              toolName: block.name,
              args: block.input ?? {},
            };
            parts.push(tc);
            toolCallMap.set(block.id, tc);
            break;
          }
          case "tool_result": {
            const tc = toolCallMap.get(block.tool_use_id);
            if (tc) {
              tc.result = block.error ? { error: block.output ?? "Unknown error" } : (block.output ?? "Done");
            }
            break;
          }
          case "text":
            parts.push({ type: "text", text: block.text });
            break;
        }
      }

      if (parts.length > 0) {
        messages.push({
          id: re.id,
          role: "assistant",
          content: parts as ThreadMessageLike["content"],
          createdAt: new Date(re.timestamp),
          status: { type: "complete", reason: "unknown" },
        });
      }
      continue;
    }

    if (event.type === "result") {
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
      continue;
    }

    if (event.type === "error") {
      messages.push({
        id: re.id,
        role: "assistant",
        content: [{ type: "text", text: `Error: ${event.detail}` }],
        createdAt: new Date(re.timestamp),
        status: { type: "incomplete", reason: "error" },
      });
      continue;
    }

    if (event.type === "rate_limit") {
      messages.push({
        id: re.id,
        role: "assistant",
        content: [
          {
            type: "text",
            text: `Rate limited — resets at ${new Date(event.resetAt).toLocaleTimeString()}`,
          },
        ],
        createdAt: new Date(re.timestamp),
        status: { type: "incomplete", reason: "error" },
      });
    }
  }

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
  const { events, sendMessage, daemonConnected } = useSessionRelay({
    sessionId,
    enabled: !!sessionId,
  });

  const messages = useMemo(() => convertEvents(events), [events]);

  // Approximation: agent is "running" when daemon is connected and task is active.
  // The relay does not expose per-turn busy state, so this is the best proxy.
  const isRunning = daemonConnected && !taskDone;

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
