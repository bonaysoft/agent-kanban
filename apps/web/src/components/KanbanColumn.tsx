import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
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
    <div data-column-status={column.status} className="min-w-0 min-h-0 border-r border-border last:border-r-0 flex flex-col h-full">
      <div className="flex items-center justify-between flex-shrink-0 px-4 pt-4 pb-3">
        <span className={`text-xs font-semibold uppercase tracking-wide ${hasRecentUpdate ? "text-accent" : "text-content-tertiary"}`}>
          {column.name}
        </span>
        <span className="font-mono text-[11px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">{column.tasks.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-column px-4 pb-4">
        <LayoutGroup>
          <AnimatePresence initial={false} mode="popLayout">
            {column.tasks.map((task: any) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25, layout: { duration: 0.3 } }}
                className="mb-2"
              >
                <TaskCard task={task} onClick={() => onTaskClick(task.id)} onAgentClick={onAgentClick} />
              </motion.div>
            ))}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </div>
  );
}
