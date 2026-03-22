import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Header } from "../components/Header";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { agentFingerprint } from "../lib/agentIdentity";
import { api } from "../lib/api";
import { formatRelative } from "../components/TaskDetailFields";

const statusDotColors: Record<string, string> = {
  online: "bg-accent animate-pulse-glow",
  offline: "bg-content-tertiary",
};

const statusLabels: Record<string, string> = {
  online: "Online",
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
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-content-primary">Agents</h1>
          <div className="flex items-center gap-4">
            <span className="text-xs text-content-tertiary font-mono">{online} online</span>
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 bg-accent text-surface-primary rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Create Agent
            </button>
          </div>
        </div>

        {showCreate && (
          <CreateAgentDialog
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); refresh(); }}
          />
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 bg-surface-secondary border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-content-secondary text-sm">No agents yet.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 text-sm text-accent hover:underline"
            >
              Create your first agent
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => {
              const isOnline = agent.status === "online";
              return (
                <Link
                  key={agent.id}
                  to={`/agents/${agent.id}`}
                  className={`block bg-surface-secondary rounded-lg px-5 py-4 transition-all border ${
                    isOnline
                      ? "border-accent/30 shadow-[0_0_20px_var(--accent-glow),0_0_40px_rgba(34,211,238,0.05)]"
                      : "border-border hover:border-content-tertiary/30"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <AgentIdenticon publicKey={agent.public_key} size={44} glow={isOnline} />
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

function CreateAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [soul, setSoul] = useState("");
  const [runtime, setRuntime] = useState("claude");
  const [model, setModel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.agents.create({
        name: name.trim(),
        bio: bio.trim() || undefined,
        soul: soul.trim() || undefined,
        runtime: runtime || undefined,
        model: model.trim() || undefined,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-secondary border border-border rounded-lg w-full max-w-md p-6 space-y-4">
          <h2 className="text-lg font-bold text-content-primary">Create Agent</h2>

          <div>
            <label className="text-xs text-content-tertiary uppercase tracking-wider block mb-1">Name *</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bolt"
              className="w-full bg-surface-primary border border-border rounded-md px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="text-xs text-content-tertiary uppercase tracking-wider block mb-1">Bio</label>
            <input
              value={bio} onChange={(e) => setBio(e.target.value)}
              placeholder="Short description"
              className="w-full bg-surface-primary border border-border rounded-md px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="text-xs text-content-tertiary uppercase tracking-wider block mb-1">Soul</label>
            <textarea
              value={soul} onChange={(e) => setSoul(e.target.value)}
              placeholder="Personality prompt..."
              rows={3}
              className="w-full bg-surface-primary border border-border rounded-md px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-content-tertiary uppercase tracking-wider block mb-1">Runtime</label>
              <select
                value={runtime} onChange={(e) => setRuntime(e.target.value)}
                className="w-full bg-surface-primary border border-border rounded-md px-3 py-2 text-sm text-content-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-content-tertiary uppercase tracking-wider block mb-1">Model</label>
              <input
                value={model} onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-20250514"
                className="w-full bg-surface-primary border border-border rounded-md px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-content-secondary hover:text-content-primary transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              className="px-4 py-2 bg-accent text-surface-primary rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
