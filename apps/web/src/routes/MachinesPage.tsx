import { useState, useEffect } from "react";
import { Header } from "../components/Header";
import { api } from "../lib/api";
import { formatRelative } from "../components/TaskDetailFields";

const statusDotColors: Record<string, string> = {
  online: "bg-success",
  offline: "bg-content-tertiary",
};

export function MachinesPage() {
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.machines.list().then(setMachines).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.machines.list().then(setMachines);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-content-primary">Machines</h1>
          <span className="text-xs text-content-tertiary font-mono">
            {machines.filter((m) => m.status === "online").length} online
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 bg-surface-secondary border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        ) : machines.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-content-secondary text-sm">No machines registered.</p>
            <p className="text-content-tertiary text-xs mt-1">Run <code className="font-mono text-accent">ak start</code> to register a machine daemon.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {machines.map((machine) => (
              <div
                key={machine.id}
                className="bg-surface-secondary border border-border rounded-lg px-5 py-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${statusDotColors[machine.status]}`} />
                    <div>
                      <span className="font-mono text-sm text-content-primary font-medium">{machine.name}</span>
                      <span className="text-xs text-content-tertiary ml-2">({machine.id})</span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-content-tertiary uppercase tracking-wide">
                    {machine.status}
                  </span>
                </div>

                <div className="mt-3 flex gap-6 text-xs text-content-secondary">
                  <div>
                    <span className="text-content-tertiary">Agents: </span>
                    <span className="font-mono text-content-primary">{machine.agent_count}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary">Active: </span>
                    <span className="font-mono text-accent">{machine.active_agent_count}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary">Last heartbeat: </span>
                    <span className="font-mono text-content-primary">
                      {formatRelative(machine.last_heartbeat_at)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
