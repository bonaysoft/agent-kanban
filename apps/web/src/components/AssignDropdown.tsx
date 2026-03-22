import { useState } from "react";
import { useAgents } from "../hooks/useAgents";
import { api } from "../lib/api";
import { AgentIdenticon } from "./AgentIdenticon";

interface AssignDropdownProps {
  taskId: string;
  currentAgent: string | null;
  onAssigned: () => void;
}

const statusDotColors: Record<string, string> = {
  online: "bg-accent animate-pulse-glow",
  offline: "bg-content-tertiary",
};

export function AssignDropdown({ taskId, currentAgent, onAssigned }: AssignDropdownProps) {
  const { agents } = useAgents();
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  async function handleAssign(agentId: string) {
    setAssigning(true);
    try {
      await api.tasks.assign(taskId, agentId);
      onAssigned();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAssigning(false);
      setOpen(false);
    }
  }

  async function handleRelease() {
    setAssigning(true);
    try {
      await api.tasks.release(taskId);
      onAssigned();
    } finally {
      setAssigning(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={assigning}
        className="text-sm text-accent hover:underline font-mono text-[13px]"
      >
        {currentAgent || "Assign..."}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-40 bg-surface-secondary border border-border rounded-lg shadow-lg min-w-[200px] py-1">
            {currentAgent && (
              <button
                onClick={handleRelease}
                className="w-full text-left px-3 py-2 text-sm text-error hover:bg-surface-tertiary"
              >
                Release task
              </button>
            )}
            {agents.length === 0 && (
              <div className="px-3 py-2 text-sm text-content-tertiary">No agents</div>
            )}
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleAssign(agent.id)}
                disabled={assigning}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-tertiary flex items-center gap-2"
              >
                <AgentIdenticon publicKey={agent.public_key} size={20} />
                <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[agent.status] || "bg-content-tertiary"}`} />
                <span className="font-mono text-[13px] text-content-primary">{agent.name}</span>
                <span className="text-[10px] text-content-tertiary ml-auto">{agent.status}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
