import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { Task } from "@agent-kanban/shared";

interface SubtaskListProps {
  parentId: string;
  onTaskClick: (taskId: string) => void;
}

export function SubtaskList({ parentId, onTaskClick }: SubtaskListProps) {
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.tasks.list({ parent: parentId }).then(setSubtasks).catch((err) => {
      const message = err instanceof Error ? err.message : "Failed to load subtasks";
      setError(message);
      console.error("[SubtaskList] fetch failed:", message);
    });
  }, [parentId]);

  if (error) {
    return <div className="text-sm text-danger pl-6 md:pl-4">{error}</div>;
  }

  if (subtasks.length === 0) return null;

  return (
    <div className="space-y-1 pl-6 md:pl-4">
      {subtasks.map((task) => (
        <button
          key={task.id}
          onClick={() => onTaskClick(task.id)}
          className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-tertiary transition-colors"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${
            task.result ? "bg-success" : task.assigned_to ? "bg-accent" : "bg-content-tertiary"
          }`} />
          <span className="text-sm text-content-secondary truncate">{task.title}</span>
          <span className="font-mono text-[10px] text-content-tertiary ml-auto">{task.id}</span>
        </button>
      ))}
    </div>
  );
}
