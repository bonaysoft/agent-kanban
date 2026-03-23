import { useEffect, useMemo, useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE";
import { formatRelative } from "./TaskDetailFields";
import { Button } from "./ui/button";
import type { TaskLog } from "@agent-kanban/shared";

interface ActivityLogProps {
  taskId: string;
  initialLogs: TaskLog[];
  assigned: boolean;
}

const actionStyles: Record<string, string> = {
  claimed: "text-accent",
  assigned: "text-accent",
  completed: "text-success",
  released: "text-warning",
  timed_out: "text-error",
  cancelled: "text-error",
  rejected: "text-warning",
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
  rejected: "Rejected",
  review_requested: "Moved to review",
};

export function ActivityLog({ taskId, initialLogs, assigned }: ActivityLogProps) {
  const { logs: sseLogs, reconnecting } = useSSE({ taskId, enabled: assigned });
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);

  // Merge initial logs with SSE logs (dedup by ID)
  const allLogs = useMemo(() => {
    const seen = new Set<string>();
    const merged: TaskLog[] = [];
    for (const log of [...initialLogs, ...sseLogs]) {
      if (!seen.has(log.id)) {
        seen.add(log.id);
        merged.push(log);
      }
    }
    return merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [initialLogs, sseLogs]);

  const displayed = allLogs.slice().reverse();

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    } else if (!autoScroll && sseLogs.length > 0) {
      setNewCount((c) => c + 1);
    }
  }, [allLogs.length, autoScroll, sseLogs.length]);

  function handleScroll() {
    if (!containerRef.current) return;
    const atTop = containerRef.current.scrollTop < 20;
    setAutoScroll(atTop);
    if (atTop) setNewCount(0);
  }

  function scrollToTop() {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewCount(0);
    setAutoScroll(true);
  }

  if (displayed.length === 0) {
    return (
      <p className="text-sm text-content-tertiary">
        No activity yet. Assign an agent to see logs.
      </p>
    );
  }

  return (
    <div className="relative">
      {reconnecting && (
        <div className="text-[10px] text-warning mb-1">Reconnecting...</div>
      )}

      {newCount > 0 && !autoScroll && (
        <Button
          onClick={scrollToTop}
          size="xs"
          className="absolute top-0 left-1/2 -translate-x-1/2 z-10 text-[11px] font-mono"
        >
          ↑ {newCount} new
        </Button>
      )}

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="space-y-0 mt-2 max-h-80 overflow-y-auto"
        aria-live="polite"
      >
        {displayed.map((log) => (
          <div
            key={log.id}
            className={`flex gap-3 py-2 border-l-2 pl-4 ml-1 ${
              log.agent_id ? "border-accent" : "border-border"
            }`}
          >
            <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
              {formatRelative(log.created_at)}
            </span>
            <span className={`text-[13px] ${
              log.action === "commented"
                ? "font-mono text-xs text-content-secondary bg-surface-primary px-1.5 py-0.5 rounded"
                : "text-content-secondary"
            }`}>
              {log.action === "commented"
                ? log.detail
                : <span className={actionStyles[log.action] || ""}>{actionLabels[log.action] || log.action}{log.detail ? `: ${log.detail}` : ""}</span>
              }
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
