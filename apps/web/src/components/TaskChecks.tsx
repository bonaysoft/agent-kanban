import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { formatRelative } from "./TaskDetailFields";

interface TaskChecksProps {
  taskId: string;
}

export function TaskChecks({ taskId }: TaskChecksProps) {
  const [checks, setChecks] = useState<any[]>([]);
  const [newDescription, setNewDescription] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = () => api.checks.list(taskId).then(setChecks).catch(() => {});

  useEffect(() => { reload(); }, [taskId]);

  async function handleAdd() {
    if (!newDescription.trim()) return;
    setAdding(true);
    await api.checks.create(taskId, newDescription.trim());
    setNewDescription("");
    setAdding(false);
    reload();
  }

  async function handleDelete(checkId: string) {
    await api.checks.delete(taskId, checkId);
    reload();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  const passedCount = checks.filter((c) => c.passed).length;

  return (
    <div className="space-y-3">
      {/* Progress */}
      {checks.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${(passedCount / checks.length) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-content-tertiary">
            {passedCount}/{checks.length}
          </span>
        </div>
      )}

      {/* Check list */}
      <div className="space-y-1">
        {checks.map((check) => (
          <CheckItem
            key={check.id}
            check={check}
            taskId={taskId}
            onUpdate={reload}
            onDelete={() => handleDelete(check.id)}
          />
        ))}
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a check..."
          disabled={adding}
          className="flex-1 bg-surface-primary border border-border rounded-md px-3 py-1.5 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={handleAdd}
          disabled={!newDescription.trim() || adding}
          className="px-3 py-1.5 bg-surface-tertiary text-content-secondary rounded-md text-sm font-medium disabled:opacity-50 hover:text-content-primary transition-colors"
        >
          Add
        </button>
      </div>

      {checks.length === 0 && (
        <p className="text-sm text-content-tertiary">
          No checks yet. Add acceptance criteria to enable auto-verification.
        </p>
      )}
    </div>
  );
}

function CheckItem({ check, taskId, onUpdate, onDelete }: { check: any; taskId: string; onUpdate: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(check.description);

  async function handleSave() {
    if (draft.trim() && draft !== check.description) {
      await api.checks.update(taskId, check.id, { description: draft.trim() });
      onUpdate();
    }
    setEditing(false);
  }

  return (
    <div className="flex items-start gap-2 group py-1">
      <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
        check.passed
          ? "bg-accent border-accent text-surface-primary"
          : "border-border"
      }`}>
        {check.passed ? <span className="text-[10px]">✓</span> : null}
      </div>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
            className="w-full text-sm bg-transparent border-b border-accent outline-none text-content-primary"
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            className={`text-sm cursor-pointer ${check.passed ? "line-through text-content-tertiary" : "text-content-secondary"}`}
          >
            {check.description}
          </span>
        )}

        {check.verified_by && (
          <div className="text-[10px] font-mono text-content-tertiary mt-0.5">
            verified {formatRelative(check.verified_at)}
          </div>
        )}
      </div>

      <button
        onClick={onDelete}
        className="text-content-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity text-xs"
      >
        ✕
      </button>
    </div>
  );
}
