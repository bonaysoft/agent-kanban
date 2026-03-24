import { TaskCard } from "./TaskCard";

interface KanbanColumnProps {
  column: any;
  onTaskClick: (taskId: string) => void;
  onAgentClick?: (agentId: string) => void;
}

export function KanbanColumn({ column, onTaskClick, onAgentClick }: KanbanColumnProps) {
  const hasRecentUpdate = column.tasks.some((t: any) => {
    const updated = new Date(t.updated_at).getTime();
    return t.assigned_to && Date.now() - updated < 5 * 60 * 1000;
  });

  return (
    <div className="min-w-0 border-r border-border last:border-r-0 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold uppercase tracking-wide ${hasRecentUpdate ? "text-accent" : "text-content-tertiary"}`}>
          {column.name}
        </span>
        <span className="font-mono text-[11px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">{column.tasks.length}</span>
      </div>

      <div className="space-y-2">
        {column.tasks.map((task: any) => (
          <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} onAgentClick={onAgentClick} />
        ))}
      </div>
    </div>
  );
}
