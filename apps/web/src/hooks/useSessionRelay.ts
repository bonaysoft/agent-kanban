import type { AgentEvent, ContentBlock } from "@agent-kanban/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "../lib/auth-client";

export type { AgentEvent, ContentBlock };

export interface RelayEvent {
  id: string;
  event: AgentEvent;
  timestamp: string;
}

interface UseSessionRelayOptions {
  sessionId: string | null;
  enabled?: boolean;
}

export function parseHistoryMessages(messages: any[]): RelayEvent[] {
  const events: RelayEvent[] = [];
  let counter = 0;
  for (const m of messages) {
    if (m.type === "assistant" && m.message?.content) {
      const blocks: ContentBlock[] = [];
      for (const block of m.message.content) {
        if (block.type === "thinking" && block.thinking) blocks.push({ type: "thinking", text: block.thinking });
        else if (block.type === "tool_use") blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        else if (block.type === "text" && block.text) blocks.push({ type: "text", text: block.text });
      }
      if (blocks.length > 0) {
        events.push({ id: m.uuid || `hist-${++counter}`, event: { type: "assistant", blocks }, timestamp: new Date().toISOString() });
      }
    } else if (m.type === "user" && m.message?.content != null) {
      // User messages from the Claude SDK come in two flavors:
      //   - tool results (assistant attribution: blocks belong to a previous assistant turn)
      //   - plain user input (human input: a real user message in the chat)
      // Plain text content can be either a string or an array of `{type:"text"}` blocks.
      const content = m.message.content;
      const toolBlocks: ContentBlock[] = [];
      const userTextParts: string[] = [];

      if (typeof content === "string") {
        if (content.trim()) userTextParts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const output =
              typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .filter((c: any) => c.type === "text")
                      .map((c: any) => c.text)
                      .join("\n")
                  : undefined;
            toolBlocks.push({ type: "tool_result", tool_use_id: block.tool_use_id, output, error: block.is_error });
          } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            userTextParts.push(block.text);
          }
        }
      }

      if (toolBlocks.length > 0) {
        events.push({
          id: m.uuid ? `${m.uuid}-tool` : `hist-${++counter}`,
          event: { type: "assistant", blocks: toolBlocks },
          timestamp: new Date().toISOString(),
        });
      }
      if (userTextParts.length > 0) {
        events.push({
          id: m.uuid ? `${m.uuid}-user` : `hist-${++counter}`,
          event: { type: "user", text: userTextParts.join("\n") },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
  return events;
}

export function useSessionRelay({ sessionId, enabled = true }: UseSessionRelayOptions) {
  const [events, setEvents] = useState<RelayEvent[]>([]);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const idCounter = useRef(0);
  const historyLoaded = useRef(false);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const token = getAuthToken();
    if (!token) return;

    let closed = false;
    historyLoaded.current = false;

    const wsUrl = `${location.origin.replace(/^http/, "ws")}/api/tunnel/ws?role=browser&sessionId=${sessionId}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (closed) return;
      setWsConnected(true);
      // Request history through the same WS
      ws.send(JSON.stringify({ type: "request:history" }));
    };

    ws.onmessage = (rawEvent) => {
      if (closed) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawEvent.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "session:history": {
          const messages = msg.messages as any[];
          if (Array.isArray(messages)) {
            const history = parseHistoryMessages(messages);
            // Merge: history as base, keep any live events that arrived before history
            setEvents((prev) => {
              const liveEvents = prev.filter((e) => e.id.startsWith("live-"));
              return [...history, ...liveEvents];
            });
            historyLoaded.current = true;
          }
          break;
        }
        case "agent:event": {
          const id = `live-${++idCounter.current}`;
          setEvents((prev) => [...prev, { id, event: msg.event as AgentEvent, timestamp: new Date().toISOString() }]);
          break;
        }
        case "daemon:connected":
          setDaemonConnected(true);
          break;
        case "daemon:disconnected":
          setDaemonConnected(false);
          break;
      }
    };

    ws.onclose = () => {
      if (closed) return;
      setWsConnected(false);
      setDaemonConnected(false);
    };

    return () => {
      closed = true;
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [sessionId, enabled]);

  const sendMessage = useCallback((content: string, senderId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "human:message", content, senderId }));
  }, []);

  return { events, sendMessage, daemonConnected, wsConnected };
}
