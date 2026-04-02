import { useEffect, useRef, useState } from "react";
import type { ContentBlock, RelayEvent } from "../hooks/useSessionRelay";
import { useSessionRelay } from "../hooks/useSessionRelay";
import { formatRelative } from "./TaskDetailFields";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface ChatPanelProps {
  taskId: string;
  agentId: string | null;
  sessionId: string | null;
  userId: string | null;
  taskDone: boolean;
}

function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "thinking":
      return (
        <details className="text-xs text-content-tertiary">
          <summary className="cursor-pointer font-mono uppercase tracking-wider">thinking</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] opacity-70">{block.text}</pre>
        </details>
      );
    case "tool_use":
      return (
        <div className="flex items-center gap-1.5 text-xs font-mono text-content-secondary">
          <span className="text-accent">▸</span>
          <span>{block.name}</span>
          {block.input && <span className="text-content-tertiary truncate max-w-[300px]">{JSON.stringify(block.input)}</span>}
        </div>
      );
    case "tool_result":
      if (!block.output) return null;
      return (
        <pre
          className={`text-[11px] font-mono whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto ${block.error ? "text-error" : "text-content-tertiary"}`}
        >
          {block.output}
        </pre>
      );
    case "text":
      return <p className="text-[13px] whitespace-pre-wrap break-words text-content-primary">{block.text}</p>;
  }
}

function EventView({ relayEvent }: { relayEvent: RelayEvent }) {
  const { event, timestamp } = relayEvent;

  if (event.type === "assistant") {
    return (
      <div className="flex gap-3 py-1.5 border-l-2 border-accent pl-4 ml-1">
        <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">{formatRelative(timestamp)}</span>
        <div className="flex-1 min-w-0 space-y-1">
          {event.blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </div>
      </div>
    );
  }

  if (event.type === "result") {
    return (
      <div className="flex gap-3 py-1.5 border-l-2 border-border pl-4 ml-1">
        <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">{formatRelative(timestamp)}</span>
        <div className="flex items-center gap-2 text-xs text-content-tertiary font-mono">
          <span>done</span>
          {event.cost != null && <span>${event.cost.toFixed(4)}</span>}
          {event.text && <span className="text-content-secondary">— {event.text.slice(0, 80)}</span>}
        </div>
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="flex gap-3 py-1.5 border-l-2 border-error pl-4 ml-1">
        <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">{formatRelative(timestamp)}</span>
        <span className="text-xs text-error">{event.detail}</span>
      </div>
    );
  }

  return null;
}

export function ChatPanel({ taskId, agentId, sessionId, userId, taskDone }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const { events, sendMessage, daemonConnected, wsConnected } = useSessionRelay({
    sessionId,
    enabled: !!sessionId,
  });

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    if (isNearBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events]);

  function handleSend() {
    if (!input.trim() || !userId) return;
    sendMessage(input.trim(), userId);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!agentId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-content-tertiary">No agent assigned. Chat is available when an agent is working on this task.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Connection status */}
      <div className="flex items-center gap-2 text-[11px] font-mono text-content-tertiary shrink-0 opacity-60">
        {sessionId && (
          <>
            <span>Session:</span>
            <Badge variant="secondary" className="font-mono text-[10px] select-all">
              {sessionId.slice(0, 8)}
            </Badge>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-xs" onClick={() => navigator.clipboard.writeText(`claude --resume ${sessionId}`)} />}
              >
                ⎘
              </TooltipTrigger>
              <TooltipContent>Copy resume command</TooltipContent>
            </Tooltip>
          </>
        )}
        {wsConnected && (
          <span className={daemonConnected ? "text-green-500" : "text-yellow-500"}>{daemonConnected ? "● live" : "● waiting for agent"}</span>
        )}
      </div>

      {/* Events stream */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {events.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-content-tertiary">{taskDone ? "No activity recorded." : "Waiting for agent activity..."}</p>
          </div>
        )}
        {events.map((re) => (
          <EventView key={re.id} relayEvent={re} />
        ))}
      </div>

      {/* Input */}
      {!taskDone && (
        <div className="flex gap-2 shrink-0">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={daemonConnected ? "Message the agent..." : "Agent not connected..."}
            disabled={!daemonConnected}
          />
          <Button onClick={handleSend} disabled={!input.trim() || !daemonConnected}>
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
