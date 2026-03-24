import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getAuthToken } from "../lib/auth-client";
import { Button } from "./ui/button";

interface AddMachineStepsProps {
  apiKey: string;
  apiKeyId: string;
  onDone: () => void;
  onConnected?: (machine: any) => void;
}

export function AddMachineSteps({ apiKey, apiKeyId, onDone, onConnected }: AddMachineStepsProps) {
  const [connected, setConnected] = useState(false);
  const [connectedMachine, setConnectedMachine] = useState<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiUrl = window.location.origin;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/auth/api-key/get?id=${apiKeyId}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) return;
      const keyData = (await res.json()) as any;
      const machineId = keyData?.metadata?.machineId;
      if (!machineId) return;
      const m = await api.machines.get(machineId);
      if (m && m.status === "online") {
        setConnected(true);
        setConnectedMachine(m);
        stopPolling();
        onConnected?.(m);
      }
    }, 3000);
    return stopPolling;
  }, [apiKeyId, stopPolling, onConnected]);

  if (connected && connectedMachine) {
    return (
      <div className="space-y-4">
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
            <span className="text-[11px] text-content-tertiary uppercase tracking-wide">
              Status
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-xs text-success">Online</span>
            </div>
          </div>
          {connectedMachine.os && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide">OS</span>
              <span className="font-mono text-[11px] text-content-primary">
                {connectedMachine.os}
              </span>
            </div>
          )}
          {connectedMachine.runtimes && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-content-tertiary uppercase tracking-wide">
                Runtimes
              </span>
              <div className="flex gap-1">
                {connectedMachine.runtimes.map((r: string) => (
                  <span
                    key={r}
                    className="text-[10px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-hidden">
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
          <span className="text-content-secondary pl-4">--api-key {apiKey}</span>
        </div>
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={() =>
          navigator.clipboard.writeText(
            `npx agent-kanban start --api-url ${apiUrl} --api-key ${apiKey}`,
          )
        }
      >
        Copy to clipboard
      </Button>
      <div className="flex items-center gap-2 py-2">
        <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        <span className="text-xs text-content-tertiary">Waiting for connection...</span>
      </div>
    </div>
  );
}
