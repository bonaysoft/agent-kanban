import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Header } from "../components/Header";
import { api } from "../lib/api";
import { authClient, getAuthToken } from "../lib/auth-client";
import { formatRelative } from "../components/TaskDetailFields";

const statusDotColors: Record<string, string> = {
  online: "bg-success",
  offline: "bg-content-tertiary",
};

type DialogStep = "choose" | "waiting" | "connected";

function randomName() {
  const adj = ["swift", "quiet", "bright", "sharp", "bold", "calm", "keen", "warm"];
  const noun = ["falcon", "cedar", "river", "spark", "forge", "ridge", "stone", "drift"];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(adj)}-${pick(noun)}`;
}

export function MachinesPage() {
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [dialogStep, setDialogStep] = useState<DialogStep>("choose");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdKeyId, setCreatedKeyId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectedMachine, setConnectedMachine] = useState<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.machines.list().then(setMachines).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.machines.list().then(setMachines);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  async function handleChooseLocal() {
    const name = randomName();
    const { data, error } = await authClient.apiKey.create({ name });
    if (error || !data) return;
    setCreatedKey(data.key);
    setCreatedKeyId(data.id);
    setDialogStep("waiting");

    // Poll API key metadata — daemon registers machineId on first heartbeat
    const keyId = data.id;
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/auth/api-key/get?id=${keyId}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) return;
      const keyData = await res.json() as any;
      const machineId = keyData?.metadata?.machineId;
      if (!machineId) return;
      const m = await api.machines.get(machineId);
      if (m && m.status === "online") {
        setConnected(true);
        setConnectedMachine(m);
        setDialogStep("connected");
        stopPolling();
        const updated = await api.machines.list();
        setMachines(updated);
      }
    }, 3000);
  }

  async function closeDialog() {
    stopPolling();
    // If API key was created but never connected, clean it up
    if (createdKeyId && !connected) {
      await authClient.apiKey.delete({ keyId: createdKeyId }).catch(() => {});
    }
    setShowDialog(false);
    setDialogStep("choose");
    setCreatedKey(null);
    setCreatedKeyId(null);
    setConnected(false);
    setConnectedMachine(null);
  }

  function handleDone() {
    stopPolling();
    setShowDialog(false);
    setDialogStep("choose");
    setCreatedKey(null);
    setCreatedKeyId(null);
    setConnected(false);
    setConnectedMachine(null);
  }

  const apiUrl = window.location.origin;

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-content-primary">Machines</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-content-tertiary font-mono">
              {machines.filter((m) => m.status === "online").length} online
            </span>
            <button
              onClick={() => setShowDialog(true)}
              className="bg-accent text-[#09090B] font-medium text-xs px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity"
            >
              Add Machine
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 bg-surface-secondary border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        ) : machines.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-content-secondary text-sm">No machines registered.</p>
            <p className="text-content-tertiary text-xs">
              Click <button onClick={() => setShowDialog(true)} className="text-accent hover:underline">Add Machine</button> to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {machines.map((machine) => (
              <Link
                key={machine.id}
                to={`/machines/${machine.id}`}
                className="block bg-surface-secondary border border-border rounded-lg px-5 py-4 hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${statusDotColors[machine.status]}`} />
                    <div>
                      <span className="font-mono text-sm text-content-primary font-medium">{machine.name}</span>
                      {machine.os && (
                        <span className="text-[11px] text-content-tertiary ml-2">{machine.os}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-content-tertiary uppercase tracking-wide">
                    {machine.status}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-6 text-xs text-content-secondary">
                  <div>
                    <span className="text-content-tertiary">Sessions: </span>
                    <span className="font-mono text-content-primary">{machine.session_count}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary">Active: </span>
                    <span className="font-mono text-accent">{machine.active_session_count}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary">Heartbeat: </span>
                    <span className="font-mono text-content-primary">
                      {machine.last_heartbeat_at ? formatRelative(machine.last_heartbeat_at) : "—"}
                    </span>
                  </div>
                  {machine.runtimes && (
                    <div className="flex gap-1 ml-auto">
                      {machine.runtimes.map((r: string) => (
                        <span key={r} className="text-[10px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded">{r}</span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Add Machine Dialog */}
      {showDialog && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeDialog} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-surface-secondary border border-border rounded-lg w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-content-primary">Add Machine</h2>
                <button onClick={closeDialog} className="text-content-tertiary hover:text-content-primary text-lg">✕</button>
              </div>

              <div className="p-5 space-y-4">
                {dialogStep === "choose" && (
                  <>
                    <p className="text-xs text-content-secondary">Where will this machine run?</p>
                    <div className="space-y-2">
                      <button
                        onClick={handleChooseLocal}
                        className="w-full flex items-center gap-3 bg-surface-primary border border-border rounded-lg px-4 py-3 hover:border-accent/50 transition-colors text-left"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-content-secondary shrink-0">
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                        <div>
                          <div className="text-sm font-medium text-content-primary">Your Computer</div>
                          <div className="text-[11px] text-content-tertiary">Run the daemon on this machine</div>
                        </div>
                      </button>
                      <button
                        disabled
                        className="w-full flex items-center gap-3 bg-surface-primary border border-border rounded-lg px-4 py-3 opacity-50 cursor-not-allowed text-left"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-content-tertiary shrink-0">
                          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                        </svg>
                        <div>
                          <div className="text-sm font-medium text-content-tertiary">Cloud Sandbox</div>
                          <div className="text-[11px] text-content-tertiary">Coming soon</div>
                        </div>
                      </button>
                    </div>
                  </>
                )}

                {dialogStep === "waiting" && createdKey && (
                  <>
                    <p className="text-xs text-content-secondary">Run this command in your terminal:</p>
                    <div className="bg-[#0C0C0C] rounded-lg overflow-hidden border border-border">
                      <div className="flex items-center gap-1.5 px-3 py-2 bg-[#1A1A1A] border-b border-border">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
                        <span className="text-[10px] text-content-tertiary ml-2 font-mono">terminal</span>
                      </div>
                      <div className="p-3 text-xs font-mono leading-relaxed overflow-x-auto whitespace-nowrap">
                        <span className="text-content-tertiary select-none">$ </span>
                        <span className="text-content-secondary">npx agent-kanban start \</span>
                        <br />
                        <span className="text-content-secondary pl-4">--api-url {apiUrl} \</span>
                        <br />
                        <span className="text-content-secondary pl-4">--api-key {createdKey}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(
                        `npx agent-kanban start --api-url ${apiUrl} --api-key ${createdKey}`
                      )}
                      className="w-full border border-border text-content-secondary font-medium text-xs py-2 rounded-lg hover:border-content-tertiary transition-colors"
                    >
                      Copy to clipboard
                    </button>
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                      <span className="text-xs text-content-tertiary">Waiting for connection...</span>
                    </div>
                  </>
                )}

                {dialogStep === "connected" && connectedMachine && (
                  <>
                    <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg p-3">
                      <div className="w-2 h-2 rounded-full bg-success" />
                      <p className="text-success text-xs font-medium">Machine connected!</p>
                    </div>
                    <div className="bg-surface-primary border border-border rounded-lg px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-content-tertiary uppercase tracking-wide">Name</span>
                        <span className="font-mono text-sm text-content-primary">{connectedMachine.name}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-content-tertiary uppercase tracking-wide">Status</span>
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-success" />
                          <span className="text-xs text-success">Online</span>
                        </div>
                      </div>
                      {connectedMachine.os && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-content-tertiary uppercase tracking-wide">OS</span>
                          <span className="font-mono text-[11px] text-content-primary">{connectedMachine.os}</span>
                        </div>
                      )}
                      {connectedMachine.runtimes && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-content-tertiary uppercase tracking-wide">Runtimes</span>
                          <div className="flex gap-1">
                            {connectedMachine.runtimes.map((r: string) => (
                              <span key={r} className="text-[10px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded">{r}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleDone}
                      className="w-full bg-accent text-[#09090B] font-medium text-sm py-2.5 rounded-lg hover:opacity-90"
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
