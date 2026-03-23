import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Header } from "../components/Header";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { CreateAgentDialog } from "../components/CreateAgentDialog";
import { agentFingerprint, agentColor, agentColorRgb } from "../lib/agentIdentity";
import { api } from "../lib/api";
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

export function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = () => api.agents.list().then(setAgents);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  const online = agents.filter((a) => a.status === "online").length;

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-baseline gap-4">
            <h1 className="text-2xl font-bold text-content-primary" style={{ letterSpacing: "-0.02em" }}>
              Agents
            </h1>
            {agents.length > 0 && (
              <span className="text-xs font-mono text-content-tertiary">
                {online}/{agents.length} online
              </span>
            )}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3.5 py-1.5 bg-accent text-surface-primary rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            New agent
          </button>
        </div>

        <CreateAgentDialog
          existingRoles={[...new Set(agents.map((a) => a.role).filter(Boolean))]}
          open={showCreate}
          onOpenChange={setShowCreate}
          onCreated={refresh}
        />

        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 bg-surface-secondary rounded-lg animate-pulse" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-content-tertiary text-sm">No agents yet.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 text-sm text-accent hover:underline"
            >
              Create your first agent
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: any }) {
  const isOnline = agent.status === "online";
  const color = agent.public_key ? agentColor(agent.public_key) : "#22D3EE";
  const rgb = agent.public_key ? agentColorRgb(agent.public_key) : "34, 211, 238";
  const fp = agent.fingerprint ? agentFingerprint(agent.fingerprint) : "";

  return (
    <Link
      to={`/agents/${agent.id}`}
      className="group block rounded-lg overflow-hidden transition-all hover:translate-y-[-2px]"
      style={{
        background: "var(--bg-secondary)",
        boxShadow: isOnline
          ? `0 4px 24px rgba(${rgb}, 0.15), 0 0 0 1px rgba(${rgb}, 0.1)`
          : "0 0 0 1px var(--border)",
      }}
    >
      {/* Top edge — agent color */}
      <div className="h-[3px]" style={{ background: color }} />

      {/* Identity — vertical, centered */}
      <div className="flex flex-col items-center pt-6 pb-4 px-5">
        <AgentIdenticon publicKey={agent.public_key} size={64} glow={isOnline} />

        <h2 className="mt-3 font-mono text-base font-bold tracking-tight" style={{ color }}>
          {agent.name}
        </h2>

        {/* Fingerprint badge */}
        <div
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
          style={{ background: `rgba(${rgb}, 0.08)` }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" className="opacity-50">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="font-mono text-[10px] tracking-[0.12em]" style={{ color: `rgba(${rgb}, 0.7)` }}>
            {fp}
          </span>
        </div>

        {/* Status */}
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={`w-[6px] h-[6px] rounded-full ${isOnline ? "animate-pulse-glow" : ""}`}
            style={{ backgroundColor: isOnline ? color : "#3f3f46" }}
          />
          <span className="text-[11px] text-content-tertiary">
            {isOnline ? "Online" : agent.last_active_at ? formatRelative(agent.last_active_at) : "Offline"}
          </span>
        </div>
      </div>

      {/* Stats strip */}
      <div className="border-t border-border/50 px-5 py-3 flex items-center justify-between text-[10px] font-mono text-content-tertiary">
        <span>{agent.task_count || 0} tasks</span>
        <span>{formatTokens((agent.input_tokens || 0) + (agent.output_tokens || 0))} tok</span>
        <span>{formatCost(agent.cost_micro_usd)}</span>
      </div>
    </Link>
  );
}

