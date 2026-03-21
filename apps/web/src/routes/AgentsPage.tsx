import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Header } from "../components/Header";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { agentFingerprint } from "../lib/agentIdentity";
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

  useEffect(() => {
    api.agents.list().then(setAgents).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.agents.list().then(setAgents);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const working = agents.filter((a) => a.status === "working").length;

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-content-primary">Agents</h1>
          <span className="text-xs text-content-tertiary font-mono">{working} working</span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 bg-surface-secondary border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-content-secondary text-sm">No agents registered.</p>
            <p className="text-content-tertiary text-xs mt-1">Agents appear when a daemon assigns tasks.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => {
              const isWorking = agent.status === "working";
              return (
                <Link
                  key={agent.id}
                  to={`/agents/${agent.id}`}
                  className={`block bg-surface-secondary rounded-lg px-5 py-4 transition-all border ${
                    isWorking
                      ? "border-accent/30 shadow-[0_0_20px_var(--accent-glow),0_0_40px_rgba(34,211,238,0.05)]"
                      : "border-border hover:border-content-tertiary/30"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <AgentIdenticon publicKey={agent.public_key} size={44} glow={isWorking} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-accent font-semibold">{agent.name}</span>
                        {agent.public_key && (
                          <span className="font-mono text-[10px] text-content-tertiary">
                            {agentFingerprint(agent.public_key)}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[agent.status]}`} />
                        <span className="text-[11px] text-content-tertiary">{statusLabels[agent.status]}</span>
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-content-tertiary">
                      {agent.last_active_at ? formatRelative(agent.last_active_at) : "—"}
                    </span>
                  </div>

                  <div className="mt-3 ml-[60px] grid grid-cols-4 gap-6 text-xs">
                    <div>
                      <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Tasks</span>
                      <span className="font-mono text-content-primary text-sm">{agent.task_count}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Input</span>
                      <span className="font-mono text-content-primary text-sm">{formatTokens(agent.input_tokens)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Output</span>
                      <span className="font-mono text-content-primary text-sm">{formatTokens(agent.output_tokens)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Cost</span>
                      <span className="font-mono text-content-primary text-sm">{formatCost(agent.cost_micro_usd)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
