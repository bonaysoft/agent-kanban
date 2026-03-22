import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import type { UsageWindow } from "@agent-kanban/shared";
import { Header } from "../components/Header";
import { api } from "../lib/api";
import { formatRelative } from "../components/TaskDetailFields";

const USAGE_LABELS: Record<string, string> = {
  five_hour: "5-Hour",
  seven_day: "7-Day",
  seven_day_sonnet: "7-Day Sonnet",
  seven_day_opus: "7-Day Opus",
};

function usageBarColor(pct: number): string {
  if (pct >= 75) return "bg-error";
  if (pct >= 40) return "bg-warning";
  return "bg-success";
}

function formatResetCountdown(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "resetting...";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const statusDotColors: Record<string, string> = {
  online: "bg-success",
  offline: "bg-content-tertiary",
};

const agentStatusDotColors: Record<string, string> = {
  idle: "bg-content-tertiary",
  working: "bg-accent animate-pulse-glow",
  offline: "bg-warning",
};

export function MachineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [machine, setMachine] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.machines.get(id).then(setMachine).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.machines.get(id).then(setMachine);
    }, 15000);
    return () => clearInterval(interval);
  }, [id]);

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    await api.machines.delete(id);
    navigate("/machines");
  }

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

  if (!machine) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto p-8">
          <p className="text-content-secondary text-sm">Machine not found.</p>
        </div>
      </div>
    );
  }

  const isOffline = machine.status === "offline";
  const apiUrl = window.location.origin;
  const runtimes = machine.runtimes || [];

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-content-tertiary">
          <Link to="/machines" className="hover:text-content-secondary transition-colors">Machines</Link>
          <span>/</span>
          <span className="text-content-secondary">{machine.name}</span>
        </div>

        {/* Machine header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${statusDotColors[machine.status]}`} />
            <h1 className="font-mono text-xl font-bold text-content-primary">{machine.name}</h1>
            <span className="text-[11px] font-mono text-content-tertiary uppercase tracking-wide">
              {machine.status}
            </span>
          </div>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="text-xs text-error hover:underline"
          >
            Delete
          </button>
        </div>

        {/* Machine info */}
        <div className="bg-surface-secondary border border-border rounded-lg px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide">OS</span>
              <span className="font-mono text-xs text-content-primary">{machine.os || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide">Version</span>
              <span className="font-mono text-xs text-content-primary">{machine.version || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide">Last Heartbeat</span>
              <span className="font-mono text-xs text-content-primary">
                {machine.last_heartbeat_at ? formatRelative(machine.last_heartbeat_at) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide">Created</span>
              <span className="font-mono text-xs text-content-primary">
                {formatRelative(machine.created_at)}
              </span>
            </div>
          </div>
          {runtimes.length > 0 && (
            <div>
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide block mb-1.5">Runtimes</span>
              <div className="flex gap-1.5">
                {runtimes.map((r: string) => (
                  <span key={r} className="text-[11px] font-mono text-accent bg-accent-soft px-2 py-0.5 rounded">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Agents</div>
            <span className="font-mono text-lg text-content-primary">{machine.agent_count}</span>
          </div>
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Active</div>
            <span className="font-mono text-lg text-accent">{machine.active_agent_count}</span>
          </div>
        </div>

        {/* Usage quota */}
        {machine.usage_info && (() => {
          const windows = Object.entries(machine.usage_info)
            .filter(([k]) => k !== "updated_at" && USAGE_LABELS[k])
            .map(([k, v]) => ({ key: k, label: USAGE_LABELS[k], ...(v as UsageWindow) }));
          if (windows.length === 0) return null;
          return (
            <div className="bg-surface-secondary border border-border rounded-lg px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide">Usage</span>
                <span className="text-[11px] font-mono text-content-tertiary">
                  {machine.usage_info.updated_at ? formatRelative(machine.usage_info.updated_at) : ""}
                </span>
              </div>
              <div className="space-y-2.5">
                {windows.map(w => (
                  <div key={w.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-content-secondary">{w.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-content-primary">{Math.round(w.utilization)}%</span>
                        <span className="text-[11px] text-content-tertiary">resets {formatResetCountdown(w.resets_at)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${usageBarColor(w.utilization)}`}
                        style={{ width: `${Math.min(w.utilization, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Offline reconnect guide */}
        {isOffline && (
          <div className="bg-warning/5 border border-warning/20 rounded-lg p-4 space-y-3">
            <div className="text-sm font-medium text-warning">Machine is offline</div>
            <p className="text-xs text-content-secondary">
              Restart the daemon to reconnect this machine:
            </p>
            <pre className="bg-surface-primary border border-border rounded-lg p-3 text-xs font-mono text-content-secondary overflow-x-auto">
{`ak start --api-url ${apiUrl}`}
            </pre>
          </div>
        )}

        {/* Agents on this machine */}
        <div>
          <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-3">
            Agents ({(machine.agents || []).length})
          </div>
          {(machine.agents || []).length === 0 ? (
            <p className="text-sm text-content-tertiary">No agents registered on this machine.</p>
          ) : (
            <div className="space-y-2">
              {(machine.agents || []).map((agent: any) => (
                <Link
                  key={agent.id}
                  to={`/agents/${agent.id}`}
                  className={`flex items-center justify-between bg-surface-secondary border rounded-lg px-4 py-3 hover:border-accent/30 transition-colors ${
                    agent.status === "working" ? "border-accent/30 shadow-[0_0_16px_rgba(34,211,238,0.06)]" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
                      <span className="font-mono text-accent text-[10px] font-bold">
                        {agent.name.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <span className="font-mono text-sm text-accent">{agent.name}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${agentStatusDotColors[agent.status] || "bg-content-tertiary"}`} />
                        <span className="text-[11px] text-content-tertiary capitalize">{agent.status}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-content-tertiary">
                    {agent.last_active_at ? formatRelative(agent.last_active_at) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowDeleteDialog(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-surface-secondary border border-border rounded-lg w-full max-w-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 space-y-4">
                <h2 className="text-sm font-semibold text-content-primary">Delete Machine</h2>
                <p className="text-xs text-content-secondary">
                  This will revoke the API key for <span className="font-mono text-content-primary">{machine.name}</span>. The daemon will stop authenticating and any running agents will lose access.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowDeleteDialog(false)}
                    className="text-xs text-content-secondary px-3 py-1.5 rounded-md border border-border hover:border-content-tertiary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs text-white bg-error px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
