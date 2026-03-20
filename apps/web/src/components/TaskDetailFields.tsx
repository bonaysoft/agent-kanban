import { useState, useEffect, useRef } from "react";

export function EditableText({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
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

export function EditableTextarea({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
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

export function EditableBadge({ value, placeholder, onSave, className }: { value: string | null; placeholder: string; onSave: (v: string) => void; className: string }) {
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

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="text-sm text-content-primary">{value}</div>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">
      {children}
    </div>
  );
}

export function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
