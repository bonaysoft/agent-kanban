import { RUNTIME_LABELS, type UsageWindow } from "@agent-kanban/shared";
import dayjs from "dayjs";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Header } from "../components/Header";
import { MachineRuntimeList } from "../components/MachineRuntimes";
import { formatRelative } from "../components/TaskDetailFields";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useDeleteMachine, useMachine } from "../hooks/useMachines";

function usageBarColor(pct: number): string {
  if (pct >= 75) return "bg-error";
  if (pct >= 40) return "bg-warning";
  return "bg-success";
}

function usagePercent(window: UsageWindow): number {
  return Math.round(window.utilization < 1 ? window.utilization * 100 : window.utilization);
}

function formatResetTime(resetsAt: string): string {
  return dayjs(resetsAt).format("MMM D, YYYY h:mm A");
}

function isPendingReset(window: UsageWindow): boolean {
  return new Date(window.resets_at).getTime() > Date.now();
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
  const { machine, loading } = useMachine(id);
  const deleteMachine = useDeleteMachine();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);

  async function handleDelete() {
    if (!id) return;
    await deleteMachine.mutateAsync(id);
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
  const usageWindows = ((machine.usage_info?.windows ?? []) as UsageWindow[]).filter(isPendingReset);

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-content-tertiary">
          <Link to="/machines" className="hover:text-content-secondary transition-colors">
            Machines
          </Link>
          <span>/</span>
          <span className="text-content-secondary">{machine.name}</span>
        </div>

        {/* Machine header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${statusDotColors[machine.status]}`} />
            <h1 className="font-mono text-xl font-bold text-content-primary">{machine.name}</h1>
            <span className="text-[11px] font-mono text-content-tertiary uppercase tracking-wide">{machine.status}</span>
          </div>
          <button onClick={() => setShowDeleteDialog(true)} className="text-xs text-error hover:underline">
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
              <span className="font-mono text-xs text-content-primary">{formatRelative(machine.created_at)}</span>
            </div>
          </div>
          <div>
            <span className="text-[11px] text-content-tertiary uppercase tracking-wide block mb-1.5">Runtimes</span>
            <MachineRuntimeList runtimes={runtimes} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Sessions</div>
            <span className="font-mono text-lg text-content-primary">{machine.session_count}</span>
          </div>
          <div className="bg-surface-secondary border border-border rounded-lg px-4 py-3">
            <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Active</div>
            <span className="font-mono text-lg text-accent">{machine.active_session_count}</span>
          </div>
        </div>

        {/* Usage quota */}
        {machine.usage_info && usageWindows.length > 0 && (
          <div className="bg-surface-secondary border border-border rounded-lg px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide">Usage</span>
              <span className="text-[11px] font-mono text-content-tertiary">
                {machine.usage_info.updated_at ? formatRelative(machine.usage_info.updated_at) : ""}
              </span>
            </div>
            <div className="space-y-2.5">
              {usageWindows.map((w, i) => (
                <div key={`${w.runtime}-${i}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-content-tertiary bg-surface-tertiary border border-border rounded px-1 py-0.5">
                        {RUNTIME_LABELS[w.runtime] ?? w.runtime}
                      </span>
                      <span className="text-xs text-content-secondary">{w.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-content-primary">{usagePercent(w)}%</span>
                      <span className="text-[11px] text-content-tertiary">Resets {formatResetTime(w.resets_at)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${usageBarColor(usagePercent(w))}`}
                      style={{ width: `${Math.min(usagePercent(w), 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Offline reconnect */}
        {isOffline && (
          <div className="bg-warning/5 border border-warning/20 rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-warning">Machine is offline</div>
              <p className="text-xs text-content-secondary mt-0.5">Generate a new API key to reconnect this machine.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowReconnect(true)}>
              Reconnect
            </Button>
          </div>
        )}

        {/* Agents on this machine */}
        <div>
          <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-3">Agents ({(machine.agents || []).length})</div>
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
                      <span className="font-mono text-accent text-[10px] font-bold">{agent.name.slice(0, 2).toUpperCase()}</span>
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

      {/* Reconnect dialog */}
      <Dialog open={showReconnect} onOpenChange={setShowReconnect}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reconnect {machine?.name}</DialogTitle>
            <DialogDescription>Run this command to reconnect:</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <pre className="bg-surface-primary border border-border rounded-lg p-3 text-xs font-mono text-content-secondary overflow-x-auto whitespace-pre-wrap break-all">
              {`ak start --api-url ${apiUrl}`}
            </pre>
            <Button variant="outline" className="w-full" onClick={() => navigator.clipboard.writeText(`ak start --api-url ${apiUrl}`)}>
              Copy to clipboard
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Machine</DialogTitle>
            <DialogDescription>
              This will revoke the API key for <span className="font-mono text-content-primary">{machine.name}</span>. The daemon will stop
              authenticating and any running agents will lose access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMachine.isPending}>
              {deleteMachine.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
