import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Header } from "../components/Header";
import { api } from "../lib/api";
import { formatRelative } from "../components/TaskDetailFields";

const statusDotColors: Record<string, string> = {
  idle: "bg-content-tertiary",
  working: "bg-accent animate-pulse-glow",
  offline: "bg-warning",
};

const statusLabels: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  offline: "Offline",
};

const actionStyles: Record<string, string> = {
  claimed: "text-accent",
  assigned: "text-accent",
  completed: "text-success",
  released: "text-warning",
  timed_out: "text-error",
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.agents.get(id).then(setAgent).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.agents.get(id).then(setAgent);
    }, 15000);
    return () => clearInterval(interval);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div className="h-6 w-48 bg-surface-tertiary rounded animate-pulse" />
          <div className="h-32 bg-surface-secondary border border-border rounded-lg animate-pulse" />
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

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-content-tertiary">
          <Link to="/agents" className="hover:text-content-secondary transition-colors">Agents</Link>
          <span>/</span>
          <span className="text-content-secondary">{agent.name}</span>
        </div>

        {/* Agent header */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
            <span className="font-mono text-accent text-base font-bold">
              {agent.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="font-mono text-xl text-accent font-bold">{agent.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[agent.status]}`} />
              <span className="text-xs text-content-secondary">{statusLabels[agent.status] || agent.status}</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Tasks</div>
            <span className="font-mono text-lg text-content-primary">{agent.task_count}</span>
          </div>
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Input Tokens</div>
            <span className="font-mono text-lg text-content-primary">{formatTokens(agent.input_tokens)}</span>
          </div>
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Output Tokens</div>
            <span className="font-mono text-lg text-content-primary">{formatTokens(agent.output_tokens)}</span>
          </div>
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Cost</div>
            <span className="font-mono text-lg text-content-primary">{formatCost(agent.cost_micro_usd)}</span>
          </div>
        </div>

        {/* Activity log */}
        <div>
          <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-3">Activity</div>
          {(!agent.logs || agent.logs.length === 0) ? (
            <p className="text-sm text-content-tertiary">No activity yet.</p>
          ) : (
            <div className="space-y-0">
              {agent.logs.map((log: any) => (
                <div
                  key={log.id}
                  className="flex gap-3 py-2 border-l-2 pl-4 ml-1 border-border"
                >
                  <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                    {formatRelative(log.created_at)}
                  </span>
                  <span className={`text-[13px] ${actionStyles[log.action] || "text-content-secondary"}`}>
                    {log.action}
                  </span>
                  {log.task_title && (
                    <span className="text-[12px] text-content-tertiary truncate ml-auto">
                      {log.task_title}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
