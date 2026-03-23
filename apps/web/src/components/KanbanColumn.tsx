import { useState } from "react";
import { TaskCard } from "./TaskCard";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface KanbanColumnProps {
  column: any;
  onTaskClick: (taskId: string) => void;
  onAgentClick?: (agentId: string) => void;
  onRefresh: () => void;
}

export function KanbanColumn({ column, onTaskClick, onAgentClick, onRefresh }: KanbanColumnProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [newTaskId, setNewTaskId] = useState<string | null>(null);

  const hasRecentUpdate = column.tasks.some((t: any) => {
    const updated = new Date(t.updated_at).getTime();
    return t.assigned_to && Date.now() - updated < 5 * 60 * 1000;
  });

  async function handleCreate() {
    if (!title.trim()) return;
    const task = await api.tasks.create({ title: title.trim() });
    setTitle("");
    setAdding(false);
    setNewTaskId(task.id);
    onRefresh();
    setTimeout(() => setNewTaskId(null), 1000);
  }

  return (
    <div className="min-w-0 border-r border-border last:border-r-0 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold uppercase tracking-wide ${hasRecentUpdate ? "text-accent" : "text-content-tertiary"}`}>
          {column.name}
        </span>
        <span className="font-mono text-[11px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
          {column.tasks.length}
        </span>
      </div>

      <div className="space-y-2">
        {column.tasks.map((task: any) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick(task.id)}
            onAgentClick={onAgentClick}
            isNew={task.id === newTaskId}
          />
        ))}
      </div>

      {column.name === "Todo" && (
        adding ? (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
            className="mt-2"
          >
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setAdding(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
              placeholder="Task title..."
            />
          </form>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            className="w-full mt-2 border-dashed"
          >
            + Task
          </Button>
        )
      )}
    </div>
  );
}
