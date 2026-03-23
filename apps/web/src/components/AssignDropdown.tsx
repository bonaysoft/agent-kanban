import { useState } from "react";
import { useAgents } from "../hooks/useAgents";
import { api } from "../lib/api";
import { AgentIdenticon } from "./AgentIdenticon";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu";

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
    }
  }

  async function handleRelease() {
    setAssigning(true);
    try {
      await api.tasks.release(taskId);
      onAssigned();
    } finally {
      setAssigning(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button variant="link" size="sm" disabled={assigning} className="font-mono text-[13px] px-0" />
      }>
        {currentAgent || "Assign..."}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[200px]">
        {currentAgent && (
          <>
            <DropdownMenuItem variant="destructive" onClick={handleRelease}>
              Release task
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {agents.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-content-tertiary">No agents</div>
        )}
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onClick={() => handleAssign(agent.id)}
            disabled={assigning}
            className="gap-2"
          >
            <AgentIdenticon publicKey={agent.public_key} size={20} />
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[agent.status] || "bg-content-tertiary"}`} />
            <span className="font-mono text-[13px] text-content-primary">{agent.name}</span>
            <span className="text-[10px] text-content-tertiary ml-auto">{agent.status}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
