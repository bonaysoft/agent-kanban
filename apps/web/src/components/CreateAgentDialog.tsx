import { useState, useEffect, useRef } from "react";
import { AgentIdenticon } from "./AgentIdenticon";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { api } from "../lib/api";
import { fetchTemplateIndex, fetchTemplate, type AgentTemplate, type TemplateIndex } from "@agent-kanban/shared";

type Step = "choose" | "recruit" | "form";

interface Props {
  existingRoles: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateAgentDialog({ existingRoles, open, onOpenChange, onCreated }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [soul, setSoul] = useState("");
  const [role, setRole] = useState("");
  const [handoffTo, setHandoffTo] = useState<string[]>([]);
  const [runtime, setRuntime] = useState("claude-code");
  const [model, setModel] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("choose");
    setSelectedTemplate(null);
    setUsername(""); setName(""); setBio(""); setSoul(""); setRole("");
    setHandoffTo([]); setRuntime("claude-code"); setModel(""); setSkills([]);
    setError(null);
  }

  function applyTemplate(t: AgentTemplate) {
    setSelectedTemplate(t);
    setUsername(t.role || t.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
    setName(t.name);
    setBio(t.bio || "");
    setSoul(t.soul || "");
    setRole(t.role || "");
    setHandoffTo(t.handoff_to || []);
    setRuntime(t.runtime || "claude-code");
    setModel(t.model || "");
    setSkills(t.skills || []);
    setStep("form");
  }

  function startCustom() {
    setSelectedTemplate(null);
    setUsername(""); setName(""); setBio(""); setSoul(""); setRole("");
    setHandoffTo([]); setRuntime("claude-code"); setModel(""); setSkills([]);
    setStep("form");
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.agents.create({
        username: username.trim(),
        name: name.trim(),
        bio: bio.trim() || undefined,
        soul: soul.trim() || undefined,
        role: role.trim() || undefined,
        handoff_to: handoffTo.length ? handoffTo : undefined,
        runtime: runtime || undefined,
        model: model.trim() || undefined,
        skills: skills.length ? skills : undefined,
      });
      onCreated();
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleOpenChange(v: boolean) {
    onOpenChange(v);
    if (!v) reset();
  }

  const maxW = step === "recruit" ? "sm:max-w-3xl" : step === "choose" ? "sm:max-w-md" : "sm:max-w-lg";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`${maxW} max-h-[calc(100vh-2rem)] overflow-y-auto`} showCloseButton={false}>
        {step === "choose" && (
          <ChooseStep onRecruit={() => setStep("recruit")} onCustom={startCustom} />
        )}
        {step === "recruit" && (
          <RecruitStep onSelect={applyTemplate} onBack={() => setStep("choose")} />
        )}
        {step === "form" && (
          <FormStep
            template={selectedTemplate}
            existingRoles={existingRoles}
            username={username} setUsername={setUsername}
            name={name} setName={setName}
            bio={bio} setBio={setBio}
            soul={soul} setSoul={setSoul}
            role={role} setRole={setRole}
            handoffTo={handoffTo} setHandoffTo={setHandoffTo}
            runtime={runtime} setRuntime={setRuntime}
            model={model} setModel={setModel}
            skills={skills} setSkills={setSkills}
            creating={creating} error={error}
            onBack={() => setStep(selectedTemplate ? "recruit" : "choose")}
            onCreate={handleCreate}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Step 1: Choose path ── */

function ChooseStep({ onRecruit, onCustom }: { onRecruit: () => void; onCustom: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>New agent</DialogTitle>
        <DialogDescription className="sr-only">Choose how to create an agent</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onRecruit}
          className="group flex flex-col items-start gap-3 p-5 rounded-lg border border-border hover:border-accent/40 bg-muted/50 transition-all text-left"
        >
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground group-hover:text-accent transition-colors">Recruit</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose from battle-tested roles</p>
          </div>
        </button>
        <button
          onClick={onCustom}
          className="group flex flex-col items-start gap-3 p-5 rounded-lg border border-border hover:border-accent/40 bg-muted/50 transition-all text-left"
        >
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground group-hover:text-accent transition-colors">Custom</p>
            <p className="text-xs text-muted-foreground mt-0.5">Build your own from scratch</p>
          </div>
        </button>
      </div>
    </>
  );
}

/* ── Step 2a: Recruit — pick a role ── */

function RecruitStep({ onSelect, onBack }: {
  onSelect: (t: AgentTemplate) => void; onBack: () => void;
}) {
  const [index, setIndex] = useState<TemplateIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplateIndex().then(setIndex).finally(() => setLoading(false));
  }, []);

  async function handleSelect(slug: string) {
    setLoadingSlug(slug);
    try {
      const t = await fetchTemplate(slug);
      if (!t.role) t.role = slug;
      onSelect(t);
    } finally {
      setLoadingSlug(null);
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} />
          <DialogTitle>Recruit an agent</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Select from available templates</DialogDescription>
      </DialogHeader>
      <div>
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {index.map((entry) => (
              <button
                key={entry.slug}
                onClick={() => handleSelect(entry.slug)}
                disabled={loadingSlug === entry.slug}
                className="group flex flex-col items-center gap-2.5 p-4 rounded-lg border border-border hover:border-accent/40 bg-muted/50 transition-all text-center disabled:opacity-60"
              >
                <AgentIdenticon publicKey={entry.slug} size={48} />
                <p className="font-mono text-sm font-bold text-foreground group-hover:text-accent transition-colors">
                  {entry.name}
                </p>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {entry.slug}
                </span>
                {loadingSlug === entry.slug && (
                  <span className="text-[10px] text-accent animate-pulse">Loading...</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Step 2b / 3: Form ── */

interface FormStepProps {
  template: AgentTemplate | null;
  existingRoles: string[];
  username: string; setUsername: (v: string) => void;
  name: string; setName: (v: string) => void;
  bio: string; setBio: (v: string) => void;
  soul: string; setSoul: (v: string) => void;
  role: string; setRole: (v: string) => void;
  handoffTo: string[]; setHandoffTo: (v: string[]) => void;
  runtime: string; setRuntime: (v: string) => void;
  model: string; setModel: (v: string) => void;
  skills: string[]; setSkills: (v: string[]) => void;
  creating: boolean; error: string | null;
  onBack: () => void;
  onCreate: () => void;
}

function FormStep(props: FormStepProps) {
  const {
    template, existingRoles, username, setUsername, name, setName, bio, setBio, soul, setSoul, role, setRole,
    handoffTo, setHandoffTo, runtime, setRuntime, model, setModel,
    skills, setSkills, creating, error, onBack, onCreate,
  } = props;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} />
          {template ? (
            <div className="flex items-center gap-2.5">
              <AgentIdenticon publicKey={template.role || template.name} size={28} />
              <DialogTitle>Recruit {template.name}</DialogTitle>
            </div>
          ) : (
            <DialogTitle>Create agent</DialogTitle>
          )}
        </div>
        <DialogDescription className="sr-only">Configure agent details</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-username">Username</Label>
          <Input id="agent-username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} placeholder="e.g. bolt" className="font-mono" />
          <p className="text-[10px] text-muted-foreground">Lowercase, used for @mentions. Cannot be changed.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bolt" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-role">Role</Label>
            <Input id="agent-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. backend-developer" className="font-mono" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-bio">Bio</Label>
          <Input id="agent-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short description" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-soul">Soul</Label>
          <Textarea id="agent-soul" value={soul} onChange={(e) => setSoul(e.target.value)} placeholder="Personality prompt..." rows={4} className="resize-none" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-runtime">Runtime</Label>
            <select id="agent-runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-model">Model</Label>
            <Input id="agent-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-6" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Handoff to</Label>
          <RoleMultiSelect selected={handoffTo} onChange={setHandoffTo} options={existingRoles} />
        </div>

        <div className="space-y-1.5">
          <Label>Skills</Label>
          <TagInput tags={skills} onChange={setSkills} placeholder="Type a skill and press Enter" />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onCreate} disabled={!username.trim() || !name.trim() || creating}>
          {creating ? "Recruiting..." : template ? "Recruit" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ── Shared components ── */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-muted-foreground hover:text-foreground transition-colors">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

function RoleMultiSelect({ selected, onChange, options }: {
  selected: string[]; onChange: (v: string[]) => void; options: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const available = options.filter((r) => !selected.includes(r));

  function toggle(role: string) {
    onChange(selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]);
  }

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => options.length > 0 && setOpen(!open)}
        className={`flex h-9 w-full items-center gap-1.5 rounded-md border px-3 text-sm shadow-xs ${
          options.length === 0 ? "border-input/50 cursor-not-allowed" : "border-input cursor-pointer"
        } focus-within:ring-1 focus-within:ring-ring`}
      >
        {selected.map((r) => (
          <span key={r} className="inline-flex items-center gap-1 bg-accent/10 text-accent font-mono text-xs px-2 py-0.5 rounded">
            {r}
            <button onClick={(e) => { e.stopPropagation(); toggle(r); }} className="hover:text-foreground transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </span>
        ))}
        {selected.length === 0 && (
          <span className="text-muted-foreground text-sm">
            {options.length === 0 ? "No roles available" : "Select roles..."}
          </span>
        )}
      </div>
      {open && available.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-md shadow-lg py-1 max-h-40 overflow-y-auto">
          {available.map((r) => (
            <button key={r} onClick={() => toggle(r)} className="w-full text-left px-3 py-1.5 text-sm font-mono text-popover-foreground hover:bg-muted transition-colors">
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TagInput({ tags, onChange, placeholder }: {
  tags: string[]; onChange: (v: string[]) => void; placeholder: string;
}) {
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
          <button onClick={(e) => { e.stopPropagation(); onChange(tags.filter((t) => t !== tag)); }} className="text-muted-foreground hover:text-foreground transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
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
