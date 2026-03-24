import { agentColor } from "../lib/agentIdentity";
import { AgentIdenticon } from "./AgentIdenticon";
import { Badge } from "./ui/badge";

interface TaskCardProps {
  task: any;
  onClick: () => void;
  onAgentClick?: (agentId: string) => void;
  isNew?: boolean;
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-500",
  high: "bg-orange-500/15 text-orange-500",
  medium: "bg-yellow-500/15 text-yellow-500",
  low: "bg-zinc-500/15 text-content-tertiary",
};

export function TaskCard({ task, onClick, onAgentClick, isNew }: TaskCardProps) {
  const isAgentActive = !!task.assigned_to && !task.result;

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left bg-surface-card border rounded-lg p-3
        transition-all duration-150 cursor-pointer
        ${
          isAgentActive
            ? "border-accent/30 shadow-[0_0_20px_var(--accent-glow),0_0_40px_rgba(34,211,238,0.05)]"
            : "border-border hover:border-content-tertiary"
        }
        ${isNew ? "animate-card-highlight" : ""}
      `}
      style={
        isAgentActive && task.agent_public_key
          ? {
              borderColor: `color-mix(in srgb, ${agentColor(task.agent_public_key)} 30%, transparent)`,
              boxShadow: `0 0 20px color-mix(in srgb, ${agentColor(task.agent_public_key)} 12%, transparent)`,
            }
          : undefined
      }
    >
      <div className="flex items-center gap-1.5 mb-2">
        <div className="text-[13px] font-medium leading-snug text-content-primary flex-1">{task.title}</div>
        {task.blocked && (
          <Badge variant="destructive" className="text-[10px] font-mono font-semibold uppercase shrink-0">
            Blocked
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {task.repository_name && (
          <Badge variant="secondary" className="text-[11px] font-mono bg-accent-soft text-accent border-none">
            {task.repository_name}
          </Badge>
        )}
        {task.priority && (
          <Badge variant="secondary" className={`text-[11px] font-mono border-none ${priorityColors[task.priority]}`}>
            {task.priority}
          </Badge>
        )}
      </div>

      {isAgentActive && (
        <div className="flex items-center gap-1.5 mt-2 text-accent">
          {task.agent_public_key && <AgentIdenticon publicKey={task.agent_public_key} size={12} />}
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-glow" />
          <span
            className="font-mono text-[11px] hover:underline"
            onClick={(e) => {
              if (onAgentClick && task.assigned_to) {
                e.stopPropagation();
                onAgentClick(task.assigned_to);
              }
            }}
          >
            {task.agent_name || task.assigned_to}
          </span>
        </div>
      )}

      {task.result && (
        <div className="font-mono text-[11px] text-success mt-1.5">Completed{task.duration_minutes ? ` in ${task.duration_minutes} min` : ""}</div>
      )}
    </button>
  );
}
