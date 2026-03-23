import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { Header } from "../components/Header";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { api } from "../lib/api";
import { agentColor, agentColorRgb } from "../lib/agentIdentity";
import { formatRelative } from "../components/TaskDetailFields";

function formatTokens(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(microUsd: number): string {
  if (!microUsd) return "$0.00";
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.sessions.get(sessionId).then(setSession).finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [session?.messages?.length]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto px-8 py-10">
          <div className="h-80 bg-surface-secondary rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto px-8 py-10">
          <p className="text-sm text-content-tertiary">Session not found.</p>
        </div>
      </div>
    );
  }

  const color = session.agent_public_key ? agentColor(session.agent_public_key) : "#22D3EE";
  const rgb = session.agent_public_key ? agentColorRgb(session.agent_public_key) : "34, 211, 238";
  const isActive = session.status === "active";
  const messages = session.messages || [];

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto px-8 py-10">
        <Link to={`/agents/${session.agent_id}`} className="text-xs text-content-tertiary hover:text-content-secondary transition-colors">
          &larr; {session.agent_name}
        </Link>

        {/* Session Header */}
        <div
          className="mt-6 rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-secondary)",
            boxShadow: `0 0 0 1px ${isActive ? `rgba(${rgb}, 0.2)` : "var(--border)"}`,
          }}
        >
          <div className="h-1" style={{ background: isActive ? color : "#3f3f46" }} />

          <div className="px-6 py-6">
            <div className="flex items-center gap-4">
              <AgentIdenticon publicKey={session.agent_public_key} size={48} glow={isActive} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-mono text-lg font-bold" style={{ color }}>
                    {session.agent_name}
                  </h1>
                  <span className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${
                    isActive ? "text-accent bg-accent/10" : "text-content-tertiary bg-surface-tertiary"
                  }`}>
                    {session.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <code className="font-mono text-[11px] text-content-tertiary">{session.id}</code>
                  {session.machine_name && (
                    <span className="text-[10px] font-mono text-content-tertiary bg-surface-tertiary rounded-full px-2 py-0.5">
                      {session.machine_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Usage strip */}
          <div className="border-t border-border/50 grid grid-cols-5 divide-x divide-border/50">
            {[
              { label: "INPUT", value: formatTokens(session.input_tokens || 0) },
              { label: "OUTPUT", value: formatTokens(session.output_tokens || 0) },
              { label: "CACHE", value: formatTokens(session.cache_read_tokens || 0) },
              { label: "COST", value: formatCost(session.cost_micro_usd || 0) },
              { label: "STARTED", value: formatRelative(session.created_at) },
            ].map((stat) => (
              <div key={stat.label} className="py-2.5 px-4 text-center">
                <div className="text-[9px] font-mono text-content-tertiary uppercase tracking-wider">{stat.label}</div>
                <div className="font-mono text-sm text-content-primary mt-0.5">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Task link */}
        {session.task && (
          <Link
            to={`/boards/${session.task.board_id}`}
            className="mt-4 flex items-center gap-3 bg-surface-secondary rounded-lg px-5 py-3 hover:bg-surface-tertiary/60 transition-colors"
            style={{ boxShadow: "0 0 0 1px var(--border)" }}
          >
            <span className="text-[10px] font-mono uppercase text-content-tertiary">TASK</span>
            <span className="text-sm text-content-primary flex-1 truncate">{session.task.title}</span>
            <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
              session.task.status === "done" ? "bg-green-500/15 text-green-500"
                : session.task.status === "in_progress" ? "bg-accent/15 text-accent"
                : "bg-zinc-500/15 text-content-tertiary"
            }`}>
              {session.task.status.replace("_", " ")}
            </span>
          </Link>
        )}

        {/* Messages */}
        <div className="mt-8">
          <h2 className="text-xs font-mono text-content-tertiary uppercase tracking-wider mb-4">
            Chat History
            <span className="ml-2 text-content-tertiary">{messages.length}</span>
          </h2>

          <div ref={containerRef} className="space-y-1">
            {messages.length === 0 && (
              <p className="text-sm text-content-tertiary py-8 text-center">No messages in this session.</p>
            )}
            {messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`flex gap-3 py-2.5 border-l-2 pl-4 ml-1 ${
                  msg.sender_type === "agent" ? "border-accent" : "border-border"
                }`}
              >
                <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                  {formatRelative(msg.created_at)}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] font-mono uppercase tracking-wider ${
                    msg.sender_type === "agent" ? "text-accent" : "text-content-tertiary"
                  }`}>
                    {msg.sender_type === "agent" ? session.agent_name : "human"}
                  </span>
                  <p className={`text-[13px] mt-0.5 whitespace-pre-wrap break-words ${
                    msg.sender_type === "agent"
                      ? "font-mono text-xs text-content-secondary"
                      : "text-content-primary"
                  }`}>
                    {msg.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
