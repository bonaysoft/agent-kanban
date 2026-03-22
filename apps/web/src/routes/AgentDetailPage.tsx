import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Header } from "../components/Header";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { api } from "../lib/api";
import { agentFingerprint, agentColor, agentColorRgb } from "../lib/agentIdentity";
import { formatRelative } from "../components/TaskDetailFields";

const statusLabels: Record<string, string> = { online: "Online", offline: "Offline" };
const statusDotClass: Record<string, string> = { online: "animate-pulse-glow", offline: "bg-content-tertiary" };

const actionStyles: Record<string, string> = {
  claimed: "text-accent", assigned: "text-accent", completed: "text-success",
  released: "text-warning", timed_out: "text-error", review_requested: "text-accent",
};

const taskStatusStyles: Record<string, string> = {
  in_progress: "bg-accent/15 text-accent", in_review: "bg-yellow-500/15 text-yellow-500",
  done: "bg-green-500/15 text-green-500", todo: "bg-zinc-500/15 text-content-tertiary",
  cancelled: "bg-red-500/15 text-red-500",
};

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

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.agents.get(id).then((a) => {
      setAgent(a);
      api.agents.sessions(id).then(setSessions).catch(() => {});
      api.tasks.list({ assigned_to: id }).then((ts) => setTask(ts[0] ?? null)).catch(() => {});
    }).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.agents.get(id).then(setAgent);
      api.agents.sessions(id).then(setSessions).catch(() => {});
      api.tasks.list({ assigned_to: id }).then((ts) => setTask(ts[0] ?? null)).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto p-8 space-y-4">
          <div className="h-6 w-48 bg-surface-tertiary rounded animate-pulse" />
          <div className="h-64 bg-surface-secondary border border-border rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto p-8">
          <p className="text-content-secondary text-sm">Agent not found.</p>
        </div>
      </div>
    );
  }

  const rgb = agent.public_key ? agentColorRgb(agent.public_key) : "34, 211, 238";
  const color = agent.public_key ? agentColor(agent.public_key) : "#22D3EE";
  const isOnline = agent.status === "online";
  const totalTokens = (agent.input_tokens || 0) + (agent.output_tokens || 0) + (agent.cache_read_tokens || 0);

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-4">
        <Link to="/agents" className="inline-flex items-center gap-1.5 text-xs text-content-tertiary hover:text-content-secondary transition-colors">
          &larr; Agents
        </Link>

        {/* ─── Identity Hero ─── */}
        <div
          className={`bg-surface-secondary rounded-lg border relative overflow-hidden transition-all ${isOnline ? "animate-breathe" : ""}`}
          style={{
            borderColor: isOnline ? `rgba(${rgb}, 0.3)` : undefined,
            "--breathe-shadow-max": `0 0 40px rgba(${rgb}, 0.15), 0 0 80px rgba(${rgb}, 0.06)`,
            "--breathe-shadow-min": `0 0 16px rgba(${rgb}, 0.05), 0 0 32px rgba(${rgb}, 0.02)`,
          } as React.CSSProperties}
        >
          {/* Agent-colored radial gradient backdrop */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at 8% 40%, rgba(${rgb}, ${isOnline ? 0.18 : 0.1}) 0%, transparent 55%)` }}
          />

          <div className="relative p-6">
            <div className="flex items-start gap-6">
              <AgentIdenticon publicKey={agent.public_key} size={96} glow={isOnline} />
              <div className="flex-1 min-w-0">
                <h1 className="font-mono text-2xl font-bold tracking-tight" style={{ color }}>
                  {agent.name}
                </h1>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${statusDotClass[agent.status]}`}
                      style={isOnline ? { backgroundColor: color } : undefined}
                    />
                    <span className="text-sm text-content-secondary">{statusLabels[agent.status]}</span>
                  </span>
                  {task && (
                    <>
                      <span className="text-content-tertiary text-xs">&middot;</span>
                      <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${taskStatusStyles[task.status]}`}>
                        {task.status.replace("_", " ")}
                      </span>
                    </>
                  )}
                </div>

                {/* Fingerprint badge */}
                {agent.public_key && (
                  <div
                    className="mt-3 inline-flex items-center gap-2 rounded-md px-3 py-1.5"
                    style={{ background: `rgba(${rgb}, 0.08)`, border: `1px solid rgba(${rgb}, 0.15)` }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
                      <path d="M12 10a2 2 0 0 0-2 2c0 1.02.1 2.51.412 4.12M12 10a2 2 0 0 1 2 2c0 1.22-.13 2.88-.5 4.5M12 10V8" />
                      <path d="M4.93 4.93A9.97 9.97 0 0 1 12 2c5.52 0 10 4.48 10 10 0 .68-.07 1.35-.2 2" />
                      <path d="M2 12c0-1.15.19-2.26.56-3.3" />
                      <path d="M6.2 6.2A6 6 0 0 1 18 12" />
                      <path d="M6 12a6 6 0 0 0 .87 3.12" />
                    </svg>
                    <span className="font-mono text-xs tracking-[0.15em]" style={{ color }}>
                      {agentFingerprint(agent.public_key)}
                    </span>
                  </div>
                )}

                {/* Runtime / Model / Machine */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {agent.runtime && (
                    <span className="text-[10px] font-mono rounded px-2 py-1" style={{ color, background: `rgba(${rgb}, 0.08)` }}>{agent.runtime}</span>
                  )}
                  {agent.model && (
                    <span className="text-[10px] font-mono rounded px-2 py-1" style={{ color, background: `rgba(${rgb}, 0.08)` }}>{agent.model}</span>
                  )}
                </div>

                {/* Bio */}
                {agent.bio && (
                  <p className="mt-2 text-sm text-content-secondary">{agent.bio}</p>
                )}
              </div>
            </div>
          </div>

          {/* Created / Last active — bottom of hero */}
          <div className="relative px-6 pb-4">
            <div className="flex gap-4 text-[10px] text-content-tertiary font-mono">
              <span>Created {formatRelative(agent.created_at)}</span>
              {agent.last_active_at && <span>Last active {formatRelative(agent.last_active_at)}</span>}
            </div>
          </div>
        </div>

        {/* ─── Telemetry Strip ─── */}
        <div className="grid grid-cols-4 gap-px rounded-lg overflow-hidden" style={{ background: `rgba(${rgb}, 0.12)` }}>
          {[
            { label: "INPUT", value: formatTokens(agent.input_tokens || 0) },
            { label: "OUTPUT", value: formatTokens(agent.output_tokens || 0) },
            { label: "CACHE", value: formatTokens(agent.cache_read_tokens || 0) },
            { label: "COST", value: formatCost(agent.cost_micro_usd || 0) },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface-secondary p-3">
              <div className="text-[10px] text-content-tertiary uppercase tracking-wider font-medium">{stat.label}</div>
              <div className="font-mono text-lg text-content-primary mt-0.5">{stat.value}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="h-1.5 rounded-full overflow-hidden flex bg-surface-tertiary">
            {totalTokens > 0 && (
              <>
                <div style={{ width: `${(agent.input_tokens / totalTokens) * 100}%`, background: `rgba(${rgb}, 0.8)` }} />
                <div style={{ width: `${(agent.output_tokens / totalTokens) * 100}%`, background: `rgba(${rgb}, 0.4)` }} />
                <div style={{ flex: 1, background: `rgba(${rgb}, 0.12)` }} />
              </>
            )}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-content-tertiary font-mono">
            <span>{formatTokens(totalTokens)} total</span>
            {totalTokens > 0 && <span>{formatCost(Math.round(agent.cost_micro_usd / (totalTokens / 1000)))} / 1K</span>}
          </div>
        </div>

        {/* ─── Mission ─── */}
        <div>
          <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-2">Mission</div>
          {task ? (
            <Link
              to={`/boards/${task.board_id}`}
              className="flex items-center gap-3 bg-surface-secondary rounded-lg px-4 py-3 hover:bg-surface-tertiary/50 transition-colors"
              style={{ borderLeft: `2px solid rgba(${rgb}, 0.5)` }}
            >
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${taskStatusStyles[task.status]}`}>
                {task.status.replace("_", " ")}
              </span>
              <span className="text-sm text-content-primary flex-1 truncate">{task.title}</span>
              {task.pr_url && (
                <a href={task.pr_url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="text-[11px] font-mono px-2 py-0.5 rounded hover:underline" style={{ color, background: `rgba(${rgb}, 0.1)` }}>PR</a>
              )}
              {task.repository_name && <span className="text-[10px] font-mono text-content-tertiary">{task.repository_name}</span>}
            </Link>
          ) : (
            <p className="text-sm text-content-tertiary">No task assigned.</p>
          )}
        </div>

        {/* ─── Session Chain (Subkey History) ─── */}
        <div>
          <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-2">Sessions</div>
          {sessions.length === 0 ? (
            <p className="text-sm text-content-tertiary">No sessions yet.</p>
          ) : (
            <div className="space-y-0">
              {sessions.map((s: any) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 py-2 border-l-2 pl-4 ml-1"
                  style={{ borderColor: s.status === "active" ? `rgba(${rgb}, 0.5)` : undefined }}
                >
                  <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                    {formatRelative(s.created_at)}
                  </span>
                  <code className="font-mono text-[11px] text-accent">{s.id.slice(0, 8)}</code>
                  <span className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${
                    s.status === "active" ? "bg-accent/15 text-accent" : "bg-zinc-500/15 text-content-tertiary"
                  }`}>
                    {s.status}
                  </span>
                  {s.machine_name && (
                    <span className="text-[11px] text-content-tertiary font-mono ml-auto">{s.machine_name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Activity ─── */}
        <div>
          <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-2">Activity</div>
          {(!agent.logs || agent.logs.length === 0) ? (
            <p className="text-sm text-content-tertiary">No activity yet.</p>
          ) : (
            <div className="space-y-0">
              {agent.logs.map((log: any) => (
                <div
                  key={log.id}
                  className="flex gap-3 py-2 border-l-2 pl-4 ml-1"
                  style={{ borderColor: actionStyles[log.action] ? `rgba(${rgb}, 0.4)` : undefined }}
                >
                  <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                    {formatRelative(log.created_at)}
                  </span>
                  <span className={`text-[13px] ${actionStyles[log.action] || "text-content-secondary"}`}>
                    {log.action}
                  </span>
                  {log.task_title && <span className="text-[12px] text-content-tertiary truncate ml-auto">{log.task_title}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
