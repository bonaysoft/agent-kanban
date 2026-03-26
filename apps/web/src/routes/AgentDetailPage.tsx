import { AGENT_RUNTIMES, type AgentRuntime, RUNTIME_LABELS } from "@agent-kanban/shared";
import React, { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { Header } from "../components/Header";
import { formatRelative } from "../components/TaskDetailFields";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useAgent, useAgentSessions, useAgentTasks, useDeleteAgent, useUpdateAgent } from "../hooks/useAgents";
import { agentColor, agentColorRgb, agentFingerprint } from "../lib/agentIdentity";

const actionStyles: Record<string, string> = {
  claimed: "text-accent",
  assigned: "text-accent",
  completed: "text-success",
  released: "text-warning",
  timed_out: "text-error",
  review_requested: "text-accent",
};

const taskStatusStyles: Record<string, string> = {
  in_progress: "bg-accent/15 text-accent",
  in_review: "bg-yellow-500/15 text-yellow-500",
  done: "bg-green-500/15 text-green-500",
  todo: "bg-zinc-500/15 text-content-tertiary",
  cancelled: "bg-red-500/15 text-red-500",
};

function formatTokens(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(microUsd: number): string {
  if (!microUsd) return "$0.00";
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

type Tab = "mission" | "activity" | "sessions";

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agent, loading } = useAgent(id);
  const { sessions } = useAgentSessions(id);
  const { tasks } = useAgentTasks(id);
  const task = tasks[0] ?? null;
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const [tab, setTab] = useState<Tab>("mission");
  const [showIdentity, setShowIdentity] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto px-8 py-10">
          <div className="h-80 bg-surface-secondary rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-4xl mx-auto px-8 py-10">
          <p className="text-content-secondary text-sm">Agent not found.</p>
        </div>
      </div>
    );
  }

  const rgb = agent.public_key ? agentColorRgb(agent.public_key) : "34, 211, 238";
  const color = agent.public_key ? agentColor(agent.public_key) : "#22D3EE";
  const fp = agent.fingerprint ? agentFingerprint(agent.fingerprint) : "";
  const isOnline = agent.status === "online";
  const totalTokens = (agent.input_tokens || 0) + (agent.output_tokens || 0) + (agent.cache_read_tokens || 0);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "mission", label: "Mission" },
    { key: "activity", label: "Activity", count: agent.logs?.length },
    { key: "sessions", label: "Sessions", count: sessions.length },
  ];

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto px-8 py-10">
        <Link to="/agents" className="text-xs text-content-tertiary hover:text-content-secondary transition-colors">
          &larr; Agents
        </Link>

        {/* ─── Identity Hero ─── */}
        <div
          className="mt-6 rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-secondary)",
            boxShadow: isOnline ? `0 8px 40px rgba(${rgb}, 0.12), 0 0 0 1px rgba(${rgb}, 0.1)` : "0 0 0 1px var(--border)",
          }}
        >
          {/* Color bar */}
          <div className="h-1" style={{ background: color }} />

          <div className="px-6 py-12 relative overflow-hidden">
            {/* Edit / Delete — top-right, above fingerprint */}
            {!agent.builtin && (
              <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                <button
                  onClick={() => setShowEdit(true)}
                  className="text-[11px] font-mono text-content-tertiary hover:text-content-secondary bg-surface-tertiary hover:bg-surface-tertiary/80 rounded px-2.5 py-1 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setShowDelete(true)}
                  className="text-[11px] font-mono text-red-500/70 hover:text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded px-2.5 py-1 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}

            {/* Fingerprint watermark — right side, clickable */}
            <button
              onClick={() => setShowIdentity(true)}
              className="absolute right-12 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-2 cursor-pointer group transition-opacity hover:opacity-100 opacity-100"
            >
              <svg
                width="128"
                height="128"
                viewBox="0 0 24 24"
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-15 group-hover:opacity-30 transition-opacity"
              >
                <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
                <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
                <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
                <path d="M2 12a10 10 0 0 1 18-6" />
                <path d="M2 16h.01" />
                <path d="M21.8 16c.2-2 .131-5.354 0-6" />
                <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
                <path d="M8.65 22c.21-.66.45-1.32.57-2" />
                <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
              </svg>
              <span className="font-mono text-[11px] tracking-[0.2em] font-medium text-content-tertiary transition-opacity">{fp}</span>
            </button>

            <div className="flex items-start gap-6 relative">
              <AgentIdenticon publicKey={agent.public_key} size={96} glow={isOnline} crystallize />

              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-3">
                  <h1 className="font-mono text-2xl font-bold text-content-primary" style={{ letterSpacing: "-0.02em" }}>
                    {agent.name}
                  </h1>
                  {agent.kind === "leader" ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#EAB308"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <title>Leader agent</title>
                      <path d="m2 4 3 12h14l3-12-6 5-4-5-4 5-6-5z" />
                      <path d="M5 20h14" />
                    </svg>
                  ) : null}
                  {agent.builtin ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="text-content-tertiary shrink-0"
                    >
                      <title>Built-in — cannot be modified</title>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ) : null}
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? "animate-pulse-glow" : ""}`}
                    style={{ backgroundColor: isOnline ? color : "#3f3f46" }}
                  />
                </div>

                {agent.bio && <p className="mt-2 text-sm text-content-secondary">{agent.bio}</p>}

                {/* Meta */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-content-tertiary bg-surface-tertiary rounded-full px-2.5 py-0.5">{agent.runtime}</span>
                  {agent.model && (
                    <span className="text-[10px] font-mono text-content-tertiary bg-surface-tertiary rounded-full px-2.5 py-0.5">{agent.model}</span>
                  )}
                  <span className="text-[10px] text-content-tertiary">Created {formatRelative(agent.created_at)}</span>
                  {agent.last_active_at && <span className="text-[10px] text-content-tertiary">Active {formatRelative(agent.last_active_at)}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Telemetry strip — inside hero card */}
          <div className="border-t border-border/50 grid grid-cols-5 divide-x divide-border/50">
            {[
              { label: "TASKS", value: String(agent.task_count || 0) },
              { label: "INPUT", value: formatTokens(agent.input_tokens || 0) },
              { label: "OUTPUT", value: formatTokens(agent.output_tokens || 0) },
              { label: "CACHE", value: formatTokens(agent.cache_read_tokens || 0) },
              { label: "COST", value: formatCost(agent.cost_micro_usd || 0) },
            ].map((stat) => (
              <div key={stat.label} className="py-3 px-4 text-center">
                <div className="text-[9px] font-mono text-content-tertiary uppercase tracking-wider">{stat.label}</div>
                <div className="font-mono text-base text-content-primary mt-0.5">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Token composition bar */}
          {totalTokens > 0 && (
            <div className="h-1 flex">
              <div style={{ width: `${(agent.input_tokens / totalTokens) * 100}%`, background: color, opacity: 0.8 }} />
              <div style={{ width: `${(agent.output_tokens / totalTokens) * 100}%`, background: color, opacity: 0.35 }} />
              <div style={{ flex: 1, background: color, opacity: 0.1 }} />
            </div>
          )}
        </div>

        {/* ─── Identity Modal ─── */}
        <IdentityModal
          open={showIdentity}
          onOpenChange={setShowIdentity}
          fingerprint={agent.fingerprint}
          publicKey={agent.public_key}
          color={color}
          rgb={rgb}
        />

        {/* ─── Edit Modal ─── */}
        <EditAgentDialog
          open={showEdit}
          onOpenChange={setShowEdit}
          agent={agent}
          onSave={async (body) => {
            await updateAgent.mutateAsync({ id: agent.id, body });
            setShowEdit(false);
          }}
          saving={updateAgent.isPending}
        />

        {/* ─── Delete Confirmation ─── */}
        <DeleteAgentDialog
          open={showDelete}
          onOpenChange={setShowDelete}
          agentName={agent.name}
          onConfirm={async () => {
            await deleteAgent.mutateAsync(agent.id);
            navigate("/agents");
          }}
          deleting={deleteAgent.isPending}
        />

        {/* ─── Soul ─── */}
        {agent.soul && (
          <div className="mt-6 bg-surface-secondary rounded-lg px-5 py-4" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
            <div className="text-[9px] font-mono text-content-tertiary uppercase tracking-wider mb-2">Soul</div>
            <p className="font-mono text-xs text-content-secondary leading-relaxed whitespace-pre-wrap">{agent.soul}</p>
          </div>
        )}

        {/* ─── Tabs ─── */}
        <div className="mt-10 flex items-center gap-6 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2.5 text-sm font-medium transition-colors relative ${
                tab === t.key ? "text-content-primary" : "text-content-tertiary hover:text-content-secondary"
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className="ml-1.5 text-[10px] font-mono text-content-tertiary">{t.count}</span>}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: color }} />}
            </button>
          ))}
        </div>

        {/* ─── Tab Content ─── */}
        <div className="mt-6 pb-16">
          {tab === "mission" && <MissionTab task={task} color={color} rgb={rgb} />}
          {tab === "activity" && <ActivityTab logs={agent.logs} rgb={rgb} />}
          {tab === "sessions" && <SessionsTab sessions={sessions} color={color} />}
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ logs, rgb }: { logs: any[]; rgb: string }) {
  if (!logs || logs.length === 0) {
    return <p className="text-sm text-content-tertiary">No activity yet.</p>;
  }

  return (
    <div className="space-y-0">
      {logs.map((log: any) => (
        <div key={log.id} className="flex items-center gap-4 py-2.5 group">
          <span className="font-mono text-[11px] text-content-tertiary w-20 shrink-0">{formatRelative(log.created_at)}</span>
          <span className={`font-mono text-[12px] w-32 shrink-0 ${actionStyles[log.action] || "text-content-tertiary"}`}>{log.action}</span>
          {log.task_title && <span className="text-sm text-content-secondary truncate">{log.task_title}</span>}
        </div>
      ))}
    </div>
  );
}

function SessionsTab({ sessions, color }: { sessions: any[]; color: string }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-content-tertiary">No sessions yet.</p>;
  }

  return (
    <div className="relative ml-2">
      <div className="absolute left-[3px] top-3 bottom-3 w-px bg-border" />

      {sessions.map((s: any) => {
        const isActive = s.status === "active";
        return (
          <div key={s.id} className="relative flex items-center gap-4 py-2.5 pl-7">
            <div
              className={`absolute left-0 w-[7px] h-[7px] rounded-full ${isActive ? "animate-pulse-glow" : ""}`}
              style={{ backgroundColor: isActive ? color : "#3f3f46" }}
            />
            <span className="font-mono text-[11px] text-content-tertiary w-20 shrink-0">{formatRelative(s.created_at)}</span>
            <code className="font-mono text-[11px] text-content-secondary">{s.id.slice(0, 12)}</code>
            <span
              className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${
                isActive ? "text-accent bg-accent/10" : "text-content-tertiary bg-surface-tertiary"
              }`}
            >
              {s.status}
            </span>
            {s.machine_name && <span className="text-[11px] text-content-tertiary font-mono ml-auto">{s.machine_name}</span>}
          </div>
        );
      })}
    </div>
  );
}

function IdentityModal({
  open,
  onOpenChange,
  fingerprint,
  publicKey,
  rgb,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fingerprint: string;
  publicKey: string;
  color: string;
  rgb: string;
}) {
  const formatFullFingerprint = (fp: string) => fp.match(/.{2}/g)?.join(":") ?? fp;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" style={{ boxShadow: `0 0 0 1px rgba(${rgb}, 0.15)` }}>
        <DialogHeader>
          <DialogTitle>Cryptographic Identity</DialogTitle>
          <DialogDescription className="sr-only">Agent cryptographic identity details</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-content-tertiary uppercase tracking-wider">Fingerprint</span>
              <button
                onClick={() => navigator.clipboard.writeText(fingerprint)}
                className="text-[10px] text-content-tertiary hover:text-content-secondary transition-colors"
              >
                Copy
              </button>
            </div>
            <div className="bg-surface-primary rounded-md p-4" style={{ border: `1px solid rgba(${rgb}, 0.1)` }}>
              <code
                className="font-mono text-[12px] text-content-secondary break-all leading-relaxed block select-all"
                style={{ wordSpacing: "0.15em" }}
              >
                {formatFullFingerprint(fingerprint)}
              </code>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-content-tertiary uppercase tracking-wider">Ed25519 Public Key</span>
              <button
                onClick={() => navigator.clipboard.writeText(publicKey)}
                className="text-[10px] text-content-tertiary hover:text-content-secondary transition-colors"
              >
                Copy
              </button>
            </div>
            <div className="bg-surface-primary rounded-md p-4" style={{ border: `1px solid rgba(${rgb}, 0.1)` }}>
              <code className="font-mono text-[12px] text-content-secondary break-all leading-relaxed block select-all">{publicKey}</code>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditAgentDialog({
  open,
  onOpenChange,
  agent,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: any;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState(agent.name ?? "");
  const [bio, setBio] = useState(agent.bio ?? "");
  const [soul, setSoul] = useState(agent.soul ?? "");
  const [role, setRole] = useState(agent.role ?? "");
  const handoffTo = agent.handoff_to ?? [];
  const [runtime, setRuntime] = useState(agent.runtime);
  const [model, setModel] = useState(agent.model ?? "");
  const [skills, setSkills] = useState<string[]>(agent.skills ?? []);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        bio: bio.trim() || undefined,
        soul: soul.trim() || undefined,
        role: role.trim() || undefined,
        handoff_to: handoffTo.length ? handoffTo : undefined,
        runtime,
        model: model.trim() || undefined,
        skills: skills.length ? skills : undefined,
      });
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit agent</DialogTitle>
          <DialogDescription className="sr-only">Edit agent properties</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Identity */}
          <fieldset className="space-y-4">
            <legend className="text-[11px] font-mono font-medium text-content-tertiary uppercase tracking-[0.08em] mb-3">Identity</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-agent-name">Name</Label>
                <Input id="edit-agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bolt" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-agent-role">Role</Label>
                <Input
                  id="edit-agent-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. backend-developer"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-agent-bio">Bio</Label>
              <Input id="edit-agent-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short description" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-agent-soul">Soul</Label>
              <Textarea
                id="edit-agent-soul"
                value={soul}
                onChange={(e) => setSoul(e.target.value)}
                placeholder="Personality prompt..."
                rows={4}
                className="resize-none"
              />
            </div>
          </fieldset>

          {/* Runtime */}
          <fieldset className="space-y-4">
            <legend className="text-[11px] font-mono font-medium text-content-tertiary uppercase tracking-[0.08em] mb-3">Runtime</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Runtime</Label>
                <Select
                  value={runtime}
                  onValueChange={(v) => {
                    if (v) setRuntime(v as AgentRuntime);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_RUNTIMES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {RUNTIME_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-agent-model">Model</Label>
                <Input id="edit-agent-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-6" />
              </div>
            </div>
          </fieldset>

          {/* Workflow */}
          <fieldset className="space-y-4">
            <legend className="text-[11px] font-mono font-medium text-content-tertiary uppercase tracking-[0.08em] mb-3">Workflow</legend>
            <div className="space-y-1.5">
              <Label>Skills</Label>
              <EditTagInput tags={skills} onChange={setSkills} placeholder="Type a skill and press Enter" />
            </div>
          </fieldset>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAgentDialog({
  open,
  onOpenChange,
  agentName,
  onConfirm,
  deleting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  onConfirm: () => Promise<void>;
  deleting: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete agent</DialogTitle>
          <DialogDescription>
            Delete agent <span className="font-mono text-content-primary">{agentName}</span>? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white border-0">
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-input px-3 py-1.5 min-h-9 cursor-text shadow-xs focus-within:ring-1 focus-within:ring-ring"
    >
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground font-mono text-xs px-2 py-0.5 rounded">
          {tag}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(tags.filter((t) => t !== tag));
            }}
            className="hover:opacity-70"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none"
      />
    </div>
  );
}

function MissionTab({ task, color, rgb }: { task: any; color: string; rgb: string }) {
  if (!task) {
    return <p className="text-sm text-content-tertiary">No active mission.</p>;
  }

  return (
    <Link
      to={`/boards/${task.board_id}`}
      className="flex items-center gap-3 bg-surface-secondary rounded-lg px-5 py-3.5 hover:bg-surface-tertiary/60 transition-colors"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: "0 0 0 1px var(--border)",
      }}
    >
      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${taskStatusStyles[task.status]}`}>{task.status.replace("_", " ")}</span>
      <span className="text-sm text-content-primary flex-1 truncate">{task.title}</span>
      {task.pr_url && (
        <a
          href={task.pr_url}
          target="_blank"
          rel="noopener"
          onClick={(e) => e.stopPropagation()}
          className="text-[11px] font-mono text-content-tertiary hover:text-content-secondary"
        >
          PR &rarr;
        </a>
      )}
      {task.repository_name && <span className="text-[10px] font-mono text-content-tertiary">{task.repository_name}</span>}
    </Link>
  );
}
