import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatRelative } from "./TaskDetailFields";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface ChatPanelProps {
  taskId: string;
  agentId: string | null;
  userId: string | null;
  taskDone: boolean;
  initialMessages: any[];
  sseMessages: any[];
}

export function ChatPanel({ taskId, agentId, userId, taskDone, initialMessages, sseMessages }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      api.messages.create(taskId, {
        sender_type: "user",
        sender_id: userId || "",
        content,
      }),
  });

  // Merge initial + SSE messages, dedup by ID
  const allMessages = (() => {
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const msg of [...initialMessages, ...sseMessages]) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        merged.push(msg);
      }
    }
    return merged.sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
  })();

  // Track whether user is near the bottom
  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  }

  // Auto-scroll to bottom when messages arrive, only if user was already at bottom
  useEffect(() => {
    if (isNearBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [allMessages]);

  async function handleSend() {
    if (!input.trim() || !agentId) return;
    const content = input.trim();
    setInput("");
    await sendMessage.mutateAsync(content);
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
      {/* Session ID for resume — subtle */}
      <div className="flex items-center gap-2 text-[11px] font-mono text-content-tertiary shrink-0 opacity-60">
        <span>Session:</span>
        <Badge variant="secondary" className="font-mono text-[10px] select-all">
          {agentId}
        </Badge>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" onClick={() => navigator.clipboard.writeText(`claude --resume ${agentId}`)} />}
          >
            ⎘
          </TooltipTrigger>
          <TooltipContent>Copy resume command</TooltipContent>
        </Tooltip>
      </div>

      {/* Messages — fills available space */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {allMessages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-content-tertiary">
              {taskDone ? "No messages were exchanged." : "No messages yet. Send a message to the agent."}
            </p>
          </div>
        )}
        {allMessages.map((msg: any) => (
          <div key={msg.id} className={`flex gap-3 py-2 border-l-2 pl-4 ml-1 ${msg.sender_type === "agent" ? "border-accent" : "border-border"}`}>
            <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">{formatRelative(msg.created_at)}</span>
            <div className="flex-1 min-w-0">
              <span
                className={`text-[11px] font-mono uppercase tracking-wider ${msg.sender_type === "agent" ? "text-accent" : "text-content-tertiary"}`}
              >
                {msg.sender_type}
              </span>
              <p
                className={`text-[13px] mt-0.5 whitespace-pre-wrap break-words ${
                  msg.sender_type === "agent" ? "font-mono text-xs text-content-secondary" : "text-content-primary"
                }`}
              >
                {msg.content}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Send error */}
      {sendMessage.isError && <p className="text-xs text-error shrink-0">Failed to send. Try again.</p>}

      {/* Input — pinned at bottom, hidden when task is done */}
      {!taskDone && (
        <div className="flex gap-2 shrink-0">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the agent..."
            disabled={sendMessage.isPending}
          />
          <Button onClick={handleSend} disabled={!input.trim() || sendMessage.isPending}>
            {sendMessage.isPending ? "..." : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
