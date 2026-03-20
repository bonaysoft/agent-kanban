import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";

interface TaskDetailProps {
  taskId: string;
  columns: { id: string; name: string }[];
  onClose: () => void;
  onRefresh: () => void;
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export function TaskDetail({ taskId, columns, onClose, onRefresh }: TaskDetailProps) {
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const reload = () => api.tasks.get(taskId).then(setTask);

  useEffect(() => {
    reload().finally(() => setLoading(false));
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

  const currentCol = columns.find((c) => c.id === task.column_id);

  return (
    <Panel>
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-border">
        <div className="flex-1 min-w-0 mr-4">
          <EditableText
            value={task.title}
            onSave={(v) => handleUpdate("title", v)}
            className="text-lg font-semibold text-content-primary"
          />
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <EditableBadge
              value={task.project}
              placeholder="+ project"
              onSave={(v) => handleUpdate("project", v || null)}
              className="bg-accent-soft text-accent"
            />
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
          <Field label="Assigned to" value={
            task.assigned_to
              ? <span className="font-mono text-[13px] text-accent">{task.assigned_to}</span>
              : <span className="text-content-tertiary">Unassigned</span>
          } />
          <Field label="Duration" value={
            task.duration_minutes != null
              ? <span className="font-mono text-[13px]">{task.duration_minutes} min</span>
              : <span className="text-content-tertiary">—</span>
          } />
        </div>

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

        <hr className="border-border" />

        {/* Activity Log */}
        <div>
          <FieldLabel>Activity</FieldLabel>
          <div className="space-y-0 mt-2">
            {(task.logs || []).slice().reverse().map((log: any) => (
              <div
                key={log.id}
                className={`flex gap-3 py-2 border-l-2 pl-4 ml-1 ${
                  log.action === "commented" ? "border-accent" : "border-border"
                }`}
              >
                <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                  {formatRelative(log.created_at)}
                </span>
                <span className={`text-[13px] ${
                  log.action === "commented"
                    ? "font-mono text-xs text-content-secondary bg-surface-primary px-1.5 py-0.5 rounded"
                    : "text-content-secondary"
                }`}>
                  {log.action === "claimed" && <span className="text-accent">Claimed</span>}
                  {log.action === "completed" && <span className="text-success">Completed</span>}
                  {log.action === "created" && "Created"}
                  {log.action === "commented" && log.detail}
                  {log.action === "moved" && `Moved${log.detail ? `: ${log.detail}` : ""}`}
                </span>
              </div>
            ))}
            {(!task.logs || task.logs.length === 0) && (
              <p className="text-sm text-content-tertiary">No activity yet.</p>
            )}
          </div>
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

function EditableText({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (draft.trim() && draft !== value) onSave(draft.trim());
    else setDraft(value);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        className={`${className} bg-transparent border-b border-accent outline-none w-full`}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`${className} cursor-pointer hover:border-b hover:border-content-tertiary`}
    >
      {value}
    </span>
  );
}

function EditableTextarea({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        rows={3}
        className="w-full text-sm bg-surface-primary border border-accent rounded-md p-2 text-content-primary outline-none resize-y"
      />
    );
  }

  return (
    <p
      onClick={() => setEditing(true)}
      className={`text-sm cursor-pointer rounded-md p-2 hover:bg-surface-tertiary transition-colors ${
        value ? "text-content-secondary" : "text-content-tertiary"
      }`}
    >
      {value || placeholder}
    </p>
  );
}

function EditableBadge({ value, placeholder, onSave, className }: { value: string | null; placeholder: string; onSave: (v: string) => void; className: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== (value || "")) onSave(draft);
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } }}
        placeholder="project name"
        className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-primary border border-accent outline-none w-24"
      />
    );
  }

  if (!value) {
    return (
      <button onClick={() => setEditing(true)} className="text-[11px] font-mono px-2 py-0.5 rounded border border-dashed border-border text-content-tertiary hover:border-content-tertiary">
        {placeholder}
      </button>
    );
  }

  return (
    <span onClick={() => setEditing(true)} className={`text-[11px] font-mono px-2 py-0.5 rounded cursor-pointer ${className}`}>
      {value}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="text-sm text-content-primary">{value}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">
      {children}
    </div>
  );
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
