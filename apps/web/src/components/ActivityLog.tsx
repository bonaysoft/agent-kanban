import { User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIdenticon } from "./AgentIdenticon";
import { formatRelative } from "./TaskDetailFields";
import { Button } from "./ui/button";

interface ActivityLogProps {
  initialNotes: any[];
  sseNotes: any[];
  reconnecting: boolean;
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

const dotColors: Record<string, string> = {
  claimed: "bg-accent border-accent/30",
  assigned: "bg-accent border-accent/30",
  completed: "bg-success border-success/30",
  released: "bg-warning border-warning/30",
  timed_out: "bg-error border-error/30",
  cancelled: "bg-error border-error/30",
  rejected: "bg-warning border-warning/30",
  review_requested: "bg-accent border-accent/30",
  commented: "bg-zinc-500 border-zinc-500/30",
  created: "bg-zinc-500 border-zinc-500/30",
  moved: "bg-zinc-500 border-zinc-500/30",
};

function buildSentence(log: any): { prefix: string; actionText: string; suffix: string } {
  const name = log.actor_name || null;
  const isAgent = log.actor_type?.startsWith("agent:");
  const defaultPrefix = isAgent ? "Agent" : log.actor_type === "user" ? "User" : "System";

  switch (log.action) {
    case "claimed":
      return { prefix: name ?? defaultPrefix, actionText: "claimed this task", suffix: "" };
    case "assigned":
      return { prefix: name ?? "System", actionText: "assigned to", suffix: log.detail ?? "agent" };
    case "completed":
      return { prefix: name ?? defaultPrefix, actionText: "completed this task", suffix: log.detail ? `— ${log.detail}` : "" };
    case "released":
      return { prefix: name ?? defaultPrefix, actionText: "released this task", suffix: "" };
    case "timed_out":
      return { prefix: name ?? defaultPrefix, actionText: "timed out", suffix: "" };
    case "cancelled":
      return { prefix: name ?? "System", actionText: "cancelled this task", suffix: log.detail ? `— ${log.detail}` : "" };
    case "rejected":
      return { prefix: name ?? "Reviewer", actionText: "rejected — sent back to agent", suffix: log.detail ? `(${log.detail})` : "" };
    case "review_requested":
      return { prefix: name ?? defaultPrefix, actionText: "submitted for review", suffix: "" };
    case "created":
      return { prefix: "System", actionText: "created this task", suffix: "" };
    case "moved":
      return { prefix: "System", actionText: "moved", suffix: log.detail ?? "" };
    case "commented":
      return { prefix: name ?? defaultPrefix, actionText: "commented", suffix: "" };
    default:
      return { prefix: name ?? "System", actionText: log.action, suffix: log.detail ?? "" };
  }
}

function NoteAvatar({ actorType, actorPublicKey }: { actorType: string | null; actorPublicKey: string | null }) {
  if (actorType?.startsWith("agent:") && actorPublicKey) {
    return <AgentIdenticon publicKey={actorPublicKey} size={20} />;
  }
  return (
    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center">
      <User className="w-3 h-3 text-content-tertiary" />
    </span>
  );
}

export function ActivityLog({ initialNotes, sseNotes, reconnecting }: ActivityLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const allNotes = (() => {
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const note of [...initialNotes, ...sseNotes]) {
      if (!seen.has(note.id)) {
        seen.add(note.id);
        merged.push(note);
      }
    }
    return merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
  })();

  const displayed = allNotes.slice().reverse();

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    } else if (!autoScroll && sseNotes.length > 0) {
      setNewCount((c) => c + 1);
    }
  }, [autoScroll, sseNotes.length]);

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
    return <p className="text-sm text-content-tertiary">No activity yet. Assign an agent to see notes.</p>;
  }

  return (
    <div className="relative">
      {reconnecting && <div className="text-[10px] text-warning mb-1">Reconnecting...</div>}

      {newCount > 0 && !autoScroll && (
        <Button onClick={scrollToTop} size="xs" className="absolute top-0 left-1/2 -translate-x-1/2 z-10 text-[11px] font-mono">
          ↑ {newCount} new
        </Button>
      )}

      <div ref={containerRef} onScroll={handleScroll} className="mt-2 max-h-80 overflow-y-auto" aria-live="polite">
        {/* Timeline container */}
        <div className="relative ml-2.5">
          {/* Vertical line */}
          <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />

          {displayed.map((log: any) => {
            const { prefix, actionText, suffix } = buildSentence(log);
            const isAgent = log.actor_type?.startsWith("agent:") && !!log.actor_public_key;
            const dot = dotColors[log.action] || "bg-zinc-500 border-zinc-500/30";
            const actionColor = actionStyles[log.action] || "text-content-secondary";
            const isComment = log.action === "commented";

            return (
              <div key={log.id} className="relative pl-5 pb-3">
                {/* Timeline dot */}
                <span className={`absolute left-0 -translate-x-1/2 mt-[3px] w-2 h-2 rounded-full border ${dot}`} style={{ top: "4px" }} />

                <div className="flex items-center gap-1.5 flex-wrap">
                  <NoteAvatar actorType={log.actor_type} actorPublicKey={log.actor_public_key} />

                  {/* Sentence: prefix (agent name) + action + suffix */}
                  <span className="text-[12px] leading-snug">
                    <span className={isAgent ? "font-mono text-accent" : "text-content-tertiary"}>{prefix}</span>{" "}
                    <span className={isComment ? "text-content-tertiary" : actionColor}>{actionText}</span>
                    {suffix && (
                      <>
                        {" "}
                        <span className="text-content-tertiary">{suffix}</span>
                      </>
                    )}
                  </span>

                  {/* Relative time */}
                  <span className="ml-auto font-mono text-[10px] text-content-tertiary whitespace-nowrap">{formatRelative(log.created_at)}</span>
                </div>

                {/* Comment body */}
                {isComment && log.detail && (
                  <div className="mt-1.5 ml-6 bg-surface-primary border border-border rounded px-2.5 py-1.5 font-mono text-[11px] text-content-secondary leading-relaxed">
                    {log.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
