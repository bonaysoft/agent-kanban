import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { useSession } from "../lib/auth-client";
import { EditableText, EditableTextarea, Field, FieldLabel } from "./TaskDetailFields";
import { TaskTimeline } from "./TaskTimeline";
import { TaskChecks } from "./TaskChecks";
import { SubtaskList } from "./SubtaskList";
import { AssignDropdown } from "./AssignDropdown";

const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "cancelled"] as const;

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
  onRefresh: () => void;
  onAgentClick?: (agentId: string) => void;
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

type Tab = "details" | "checks";

export function TaskDetail({ taskId, onClose, onRefresh, onAgentClick }: TaskDetailProps) {
  const { data: session } = useSession();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [repositories, setRepositories] = useState<{ id: string; name: string }[]>([]);
  const [depTitles, setDepTitles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [initialComments, setInitialComments] = useState<any[]>([]);
  const { logs: sseLogs, comments: sseComments } = useSSE({ taskId, enabled: true });

  const reload = () => api.tasks.get(taskId).then(setTask);

  useEffect(() => {
    reload().finally(() => setLoading(false));
    api.comments.list(taskId).then(setInitialComments).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    api.repositories.list().then(setRepositories).catch(() => {});
  }, []);

  useEffect(() => {
    if (!task?.depends_on || task.depends_on.length === 0) return;
    const depIds: string[] = task.depends_on;
    Promise.all(depIds.map((id) => api.tasks.get(id).then((t: any) => [id, t.title] as const)))
      .then((entries) => setDepTitles(Object.fromEntries(entries)));
  }, [task?.depends_on]);

  async function handleUpdate(field: string, value: string | null) {
    await api.tasks.update(taskId, { [field]: value });
    await reload();
    onRefresh();
  }

  async function handleStatusChange(status: string) {
    await api.tasks.update(taskId, { status });
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

  const dependsOn: string[] = task.depends_on || [];

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
              value={task.repository_id || ""}
              onChange={(e) => handleUpdate("repository_id", e.target.value || null)}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-accent-soft text-accent border-none outline-none cursor-pointer"
            >
              <option value="">no repo</option>
              {repositories.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
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

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("details")}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "details"
              ? "text-content-primary border-b-2 border-accent"
              : "text-content-tertiary hover:text-content-secondary"
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setActiveTab("checks")}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "checks"
              ? "text-accent border-b-2 border-accent"
              : "text-content-tertiary hover:text-content-secondary"
          }`}
        >
          Checks
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "details" && (
        <div className="p-5 space-y-4">
          {/* Status row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="text-sm bg-transparent text-accent border-none outline-none cursor-pointer"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
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
                  <span key={depId} className="text-[11px] px-2 py-0.5 rounded bg-surface-tertiary text-content-secondary">
                    {depTitles[depId] || depId}
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

          {/* Timeline */}
          <div>
            <FieldLabel>Timeline</FieldLabel>
            <TaskTimeline
              taskId={taskId}
              initialLogs={task.logs || []}
              initialComments={initialComments}
              sseLogs={sseLogs}
              sseComments={sseComments}
              userId={session?.user?.id || null}
              taskDone={task.status === "done" || task.status === "cancelled"}
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
      )}

      {activeTab === "checks" && (
        <div className="p-5">
          <TaskChecks taskId={taskId} />
        </div>
      )}
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
