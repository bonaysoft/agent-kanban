import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { EditableText, EditableTextarea, Field, FieldLabel } from "./TaskDetailFields";
import { ActivityLog } from "./ActivityLog";
import { SubtaskList } from "./SubtaskList";
import { AssignDropdown } from "./AssignDropdown";

interface TaskDetailProps {
  taskId: string;
  columns: { id: string; name: string }[];
  onClose: () => void;
  onRefresh: () => void;
  onAgentClick?: (agentId: string) => void;
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export function TaskDetail({ taskId, columns, onClose, onRefresh, onAgentClick }: TaskDetailProps) {
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const reload = () => api.tasks.get(taskId).then(setTask);

  useEffect(() => {
    reload().finally(() => setLoading(false));
    api.projects.list().then(setProjects);
  }, [taskId]);

  async function handleUpdate(field: string, value: string | null) {
    await api.tasks.update(taskId, { [field]: value });
    await reload();
    onRefresh();
  }

  async function handleColumnChange(columnId: string) {
    await api.tasks.update(taskId, { column_id: columnId });
    await reload();
    onRefresh();
  }

  async function handleDelete() {
    await api.tasks.delete(taskId);
    onClose();
    onRefresh();
  }

  if (loading) {
    return (
      <Panel>
        <div className="p-6 animate-pulse space-y-4">
          <div className="h-6 bg-surface-tertiary rounded w-3/4" />
          <div className="h-4 bg-surface-tertiary rounded w-1/2" />
          <div className="h-20 bg-surface-tertiary rounded" />
        </div>
      </Panel>
    );
  }

  if (!task) {
    return (
      <Panel>
        <div className="p-6">
          <p className="text-content-secondary">Task not found.</p>
          <button onClick={onClose} className="mt-4 text-accent text-sm">Back to board</button>
        </div>
      </Panel>
    );
  }

  const dependsOn: string[] = task.depends_on ? JSON.parse(task.depends_on) : [];

  return (
    <Panel>
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-border">
        <div className="flex-1 min-w-0 mr-4">
          <div className="flex items-center gap-2">
            <EditableText
              value={task.title}
              onSave={(v) => handleUpdate("title", v)}
              className="text-lg font-semibold text-content-primary"
            />
            {task.blocked && (
              <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-error/15 text-error">
                Blocked
              </span>
            )}
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <select
              value={task.project_id || ""}
              onChange={(e) => handleUpdate("project_id", e.target.value || null)}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-accent-soft text-accent border-none outline-none cursor-pointer"
            >
              <option value="">no project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={task.priority || ""}
              onChange={(e) => handleUpdate("priority", e.target.value || null)}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-tertiary text-content-secondary border-none outline-none cursor-pointer"
            >
              <option value="">no priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <button onClick={onClose} className="text-content-tertiary hover:text-content-primary text-lg">✕</button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* Status row */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <FieldLabel>Column</FieldLabel>
            <select
              value={task.column_id}
              onChange={(e) => handleColumnChange(e.target.value)}
              className="text-sm bg-transparent text-accent border-none outline-none cursor-pointer"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Assigned to</FieldLabel>
            <AssignDropdown
              taskId={taskId}
              currentAgent={task.agent_name || null}
              onAssigned={() => { reload(); onRefresh(); }}
            />
          </div>
          <Field label="Duration" value={
            task.duration_minutes != null
              ? <span className="font-mono text-[13px]">{task.duration_minutes} min</span>
              : <span className="text-content-tertiary">—</span>
          } />
        </div>

        {/* Dependencies */}
        {dependsOn.length > 0 && (
          <div>
            <FieldLabel>Depends on</FieldLabel>
            <div className="flex gap-1.5 flex-wrap">
              {dependsOn.map((depId) => (
                <span key={depId} className="font-mono text-[11px] px-2 py-0.5 rounded bg-surface-tertiary text-content-secondary">
                  {depId}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <FieldLabel>Description</FieldLabel>
          <EditableTextarea
            value={task.description || ""}
            placeholder="Add a description..."
            onSave={(v) => handleUpdate("description", v || null)}
          />
        </div>

        {/* Input (read-only) */}
        {task.input && (
          <div>
            <FieldLabel>Input</FieldLabel>
            <pre className="text-xs font-mono bg-surface-primary border border-border rounded-md p-3 text-content-secondary overflow-x-auto">
              {JSON.stringify(JSON.parse(task.input), null, 2)}
            </pre>
          </div>
        )}

        {/* Result */}
        {task.result && (
          <div>
            <FieldLabel>Result</FieldLabel>
            <p className="text-sm text-content-secondary">{task.result}</p>
          </div>
        )}

        {/* PR */}
        {task.pr_url && (
          <div>
            <FieldLabel>PR</FieldLabel>
            <a href={task.pr_url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
              {task.pr_url}
            </a>
          </div>
        )}

        {/* Subtasks */}
        {task.subtask_count > 0 && (
          <>
            <hr className="border-border" />
            <div>
              <FieldLabel>Subtasks ({task.subtask_count})</FieldLabel>
              <SubtaskList parentId={taskId} onTaskClick={(id) => { /* navigate to subtask */ }} />
            </div>
          </>
        )}

        <hr className="border-border" />

        {/* Activity Log */}
        <div>
          <FieldLabel>Activity</FieldLabel>
          <ActivityLog
            taskId={taskId}
            initialLogs={task.logs || []}
            assigned={!!task.assigned_to}
          />
        </div>

        <hr className="border-border" />

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="text-xs text-error hover:underline"
        >
          Delete task
        </button>
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <aside className="fixed right-0 top-0 h-full w-full md:w-1/2 bg-surface-secondary border-l border-border z-50 overflow-y-auto">
      {children}
    </aside>
  );
}
