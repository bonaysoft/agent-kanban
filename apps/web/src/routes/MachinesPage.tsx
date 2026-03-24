import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AddMachineSteps } from "../components/AddMachineSteps";
import { Header } from "../components/Header";
import { formatRelative } from "../components/TaskDetailFields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";

const statusDotColors: Record<string, string> = {
  online: "bg-success",
  offline: "bg-content-tertiary",
};

type DialogStep = "choose" | "waiting";

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

  useEffect(() => {
    api.machines
      .list()
      .then(setMachines)
      .finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.machines.list().then(setMachines);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleChooseLocal() {
    const name = randomName();
    const { data, error } = await authClient.apiKey.create({ name });
    if (error || !data) return;
    setCreatedKey(data.key);
    setCreatedKeyId(data.id);
    setDialogStep("waiting");
  }

  const handleConnected = useCallback(async () => {
    setConnected(true);
    const updated = await api.machines.list();
    setMachines(updated);
  }, []);

  async function closeDialog() {
    if (createdKeyId && !connected) {
      await authClient.apiKey.delete({ keyId: createdKeyId }).catch(() => {});
    }
    resetDialog();
  }

  function resetDialog() {
    setShowDialog(false);
    setDialogStep("choose");
    setCreatedKey(null);
    setCreatedKeyId(null);
    setConnected(false);
  }

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
              type="button"
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
              <div
                key={i}
                className="h-20 bg-surface-secondary border border-border rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : machines.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-content-secondary text-sm">No machines registered.</p>
            <p className="text-content-tertiary text-xs">
              Click{" "}
              <button
                type="button"
                onClick={() => setShowDialog(true)}
                className="text-accent hover:underline"
              >
                Add Machine
              </button>{" "}
              to get started.
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
                      <span className="font-mono text-sm text-content-primary font-medium">
                        {machine.name}
                      </span>
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
                        <span
                          key={r}
                          className="text-[10px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded"
                        >
                          {r}
                        </span>
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
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Add Machine</DialogTitle>
            <DialogDescription className="sr-only">
              Add a new machine to run agents
            </DialogDescription>
          </DialogHeader>

          {dialogStep === "choose" && (
            <div className="space-y-2">
              <p className="text-xs text-content-secondary">Where will this machine run?</p>
              <button
                type="button"
                onClick={handleChooseLocal}
                className="w-full flex items-center gap-3 bg-surface-primary border border-border rounded-lg px-4 py-3 hover:border-accent/50 transition-colors text-left"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-content-secondary shrink-0"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <div>
                  <div className="text-sm font-medium text-content-primary">Your Computer</div>
                  <div className="text-[11px] text-content-tertiary">
                    Run the daemon on this machine
                  </div>
                </div>
              </button>
              <button
                type="button"
                disabled
                className="w-full flex items-center gap-3 bg-surface-primary border border-border rounded-lg px-4 py-3 opacity-50 cursor-not-allowed text-left"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-content-tertiary shrink-0"
                >
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                </svg>
                <div>
                  <div className="text-sm font-medium text-content-tertiary">Cloud Sandbox</div>
                  <div className="text-[11px] text-content-tertiary">Coming soon</div>
                </div>
              </button>
            </div>
          )}

          {dialogStep === "waiting" && createdKey && createdKeyId && (
            <AddMachineSteps
              apiKey={createdKey}
              apiKeyId={createdKeyId}
              onDone={resetDialog}
              onConnected={handleConnected}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
