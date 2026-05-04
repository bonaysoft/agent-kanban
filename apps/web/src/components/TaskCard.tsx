import dayjs from "dayjs";

import { agentColor } from "../lib/agentIdentity";
import { AgentIdenticon } from "./AgentIdenticon";
import { Badge } from "./ui/badge";

interface TaskCardProps {
  task: any;
  onClick: () => void;
  onAgentClick?: (task: any) => void;
  isNew?: boolean;
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-500",
  high: "bg-orange-500/15 text-orange-500",
  medium: "bg-yellow-500/15 text-yellow-500",
  low: "bg-zinc-500/15 text-content-tertiary",
};

export function TaskCard({ task, onClick, onAgentClick, isNew }: TaskCardProps) {
  const isAssigned = !!task.assigned_to;
  const isWorking = isAssigned && !!task.agent_public_key && task.status === "in_progress" && !task.glow_suppressed;

  return (
    <div
      data-task-id={task.id}
      className={`
        w-full text-left bg-surface-card border rounded-lg p-3
        transition-[border-color,box-shadow,filter,color] duration-150 cursor-pointer
        ${
          isWorking
            ? "border-accent/30 shadow-[0_0_20px_var(--accent-glow),0_0_40px_rgba(34,211,238,0.05)]"
            : "border-border hover:border-content-tertiary"
        }
        ${isNew ? "animate-card-highlight" : ""}
      `}
      style={
        isWorking && task.agent_public_key
          ? {
              borderColor: `color-mix(in srgb, ${agentColor(task.agent_public_key)} 30%, transparent)`,
              boxShadow: `0 0 20px color-mix(in srgb, ${agentColor(task.agent_public_key)} 12%, transparent)`,
            }
          : undefined
      }
    >
      <button type="button" onClick={onClick} className="w-full text-left">
        <div className="flex items-start gap-1.5 mb-2">
          <span className="font-mono text-[11px] leading-snug text-content-tertiary shrink-0">#{task.seq}</span>
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
          {task.scheduled_at && new Date(task.scheduled_at).getTime() > Date.now() && (
            <span className="font-mono text-[11px] text-content-tertiary" title={task.scheduled_at}>
              🕐 {dayjs(task.scheduled_at).format("MM-DD HH:mm")}
            </span>
          )}
        </div>
      </button>

      {isAssigned && (
        <button
          type="button"
          data-agent-section
          className={`flex items-center gap-1.5 mt-2 transition-colors duration-500 ${isWorking ? "text-accent" : "text-content-tertiary"}`}
          onClick={() => onAgentClick?.(task)}
          aria-label={`Open chat with ${task.agent_name || task.assigned_to}`}
        >
          {task.agent_public_key && (
            <div className="transition-[filter] duration-500" style={{ filter: isWorking ? "none" : "grayscale(1) opacity(0.5)" }}>
              <AgentIdenticon publicKey={task.agent_public_key} size={12} />
            </div>
          )}
          {isWorking && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-glow" />}
          <span className="font-mono text-[11px] hover:underline">{task.agent_name || task.assigned_to}</span>
        </button>
      )}

      {task.result && task.duration_minutes && (
        <button type="button" onClick={onClick} className="font-mono text-[11px] text-success mt-1.5">
          {task.duration_minutes} min
        </button>
      )}
    </div>
  );
}
