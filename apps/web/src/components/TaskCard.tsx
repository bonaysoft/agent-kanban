interface TaskCardProps {
  task: any;
  onClick: () => void;
  isNew?: boolean;
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-500",
  high: "bg-orange-500/15 text-orange-500",
  medium: "bg-yellow-500/15 text-yellow-500",
  low: "bg-zinc-500/15 text-content-tertiary",
};

export function TaskCard({ task, onClick, isNew }: TaskCardProps) {
  const isAgentActive = !!task.assigned_to && !task.result;

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left bg-surface-card border rounded-lg p-3 mb-2
        transition-all duration-150 cursor-pointer
        ${isAgentActive
          ? "border-accent/30 shadow-[0_0_20px_var(--accent-glow),0_0_40px_rgba(34,211,238,0.05)]"
          : "border-border hover:border-content-tertiary"
        }
        ${isNew ? "animate-card-highlight" : ""}
      `}
    >
      <div className="text-[13px] font-medium mb-2 leading-snug text-content-primary">
        {task.title}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {task.project && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-accent-soft text-accent">
            {task.project}
          </span>
        )}
        {task.priority && (
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${priorityColors[task.priority]}`}>
            {task.priority}
          </span>
        )}
      </div>

      {isAgentActive && (
        <div className="flex items-center gap-1.5 mt-2 text-accent">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-glow" />
          <span className="font-mono text-[11px]">{task.assigned_to}</span>
        </div>
      )}

      {task.result && (
        <div className="font-mono text-[11px] text-success mt-1.5">
          Completed{task.duration_minutes ? ` in ${task.duration_minutes} min` : ""}
        </div>
      )}
    </button>
  );
}
