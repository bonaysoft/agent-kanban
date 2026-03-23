import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";
import { formatRelative } from "./TaskDetailFields";

interface TimelineEntry {
  id: string;
  type: "action" | "comment";
  created_at: string;
  data: any;
}

interface TaskTimelineProps {
  taskId: string;
  initialLogs: any[];
  initialComments: any[];
  sseLogs: any[];
  sseComments: any[];
  userId: string | null;
  taskDone: boolean;
}

const actionStyles: Record<string, string> = {
  claimed: "text-accent",
  assigned: "text-accent",
  completed: "text-success",
  released: "text-warning",
  timed_out: "text-error",
  cancelled: "text-error",
  review_requested: "text-accent",
};

const actionLabels: Record<string, string> = {
  claimed: "Claimed",
  assigned: "Assigned",
  completed: "Completed",
  created: "Created",
  released: "Released",
  timed_out: "Timed out",
  moved: "Moved",
  cancelled: "Cancelled",
  review_requested: "Moved to review",
};

function dedup<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

function highlightMentions(text: string): (string | JSX.Element)[] {
  const parts = text.split(/(@[a-z][a-z0-9_-]{1,30})/g);
  return parts.map((part, i) =>
    part.startsWith("@")
      ? <span key={i} className="text-accent font-medium">{part}</span>
      : part
  );
}

export function TaskTimeline({ taskId, initialLogs, initialComments, sseLogs, sseComments, userId, taskDone }: TaskTimelineProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const allLogs = dedup([...initialLogs, ...sseLogs]);
  const allComments = dedup([...initialComments, ...sseComments]);

  const entries: TimelineEntry[] = [
    ...allLogs.filter((l) => l.action !== "commented").map((l) => ({ id: l.id, type: "action" as const, created_at: l.created_at, data: l })),
    ...allComments.map((c) => ({ id: c.id, type: "comment" as const, created_at: c.created_at, data: c })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries.length]);

  async function handleSend() {
    if (!input.trim()) return;
    setSending(true);
    try {
      await api.comments.create(taskId, { content: input.trim() });
      setInput("");
    } catch { /* ignore */ }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={containerRef}
        className="space-y-0 max-h-96 overflow-y-auto"
      >
        {entries.length === 0 && (
          <p className="text-sm text-content-tertiary py-2">No activity yet.</p>
        )}
        {entries.map((entry) => (
          <div key={entry.id}>
            {entry.type === "action" ? (
              <ActionRow log={entry.data} />
            ) : (
              <CommentRow comment={entry.data} />
            )}
          </div>
        ))}
      </div>

      {!taskDone && (
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Leave a comment... Use @username to mention"
            disabled={sending}
            className="flex-1 bg-surface-primary border border-border rounded-md px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="px-4 py-2 bg-accent text-surface-primary rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}

function ActionRow({ log }: { log: any }) {
  return (
    <div className="flex gap-3 py-1.5 border-l-2 pl-4 ml-1 border-border">
      <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
        {formatRelative(log.created_at)}
      </span>
      <span className={`text-[13px] text-content-secondary`}>
        <span className={actionStyles[log.action] || ""}>{actionLabels[log.action] || log.action}</span>
        {log.detail ? <span className="text-content-tertiary"> — {log.detail}</span> : null}
      </span>
    </div>
  );
}

function CommentRow({ comment }: { comment: any }) {
  const isAgent = comment.author_type === "agent";
  return (
    <div className={`flex gap-3 py-2 border-l-2 pl-4 ml-1 ${isAgent ? "border-accent" : "border-border"}`}>
      <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
        {formatRelative(comment.created_at)}
      </span>
      <div className="flex-1 min-w-0">
        <span className={`text-[11px] font-mono uppercase tracking-wider ${
          isAgent ? "text-accent" : "text-content-tertiary"
        }`}>
          {comment.author_type}
        </span>
        <p className={`text-[13px] mt-0.5 whitespace-pre-wrap break-words ${
          isAgent ? "font-mono text-xs text-content-secondary" : "text-content-primary"
        }`}>
          {highlightMentions(comment.content)}
        </p>
      </div>
    </div>
  );
}
