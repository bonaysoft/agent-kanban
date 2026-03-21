import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Header } from "../components/Header";
import { AgentIdenticon } from "../components/AgentIdenticon";
import { api } from "../lib/api";
import { agentFingerprint, agentColorRgb } from "../lib/agentIdentity";
import { formatRelative } from "../components/TaskDetailFields";

const CAPABILITIES = [
  { name: "claim_task", label: "Claim" },
  { name: "complete_task", label: "Complete" },
  { name: "review_task", label: "Review" },
  { name: "create_task", label: "Create" },
  { name: "cancel_task", label: "Cancel" },
  { name: "send_message", label: "Chat" },
  { name: "read_task", label: "Read" },
];

const statusLabels: Record<string, string> = { idle: "Idle", working: "Working", offline: "Offline" };
const statusDotColors: Record<string, string> = { idle: "bg-content-tertiary", working: "bg-accent animate-pulse-glow", offline: "bg-warning" };

const actionStyles: Record<string, string> = {
  claimed: "text-accent", assigned: "text-accent", completed: "text-success",
  released: "text-warning", timed_out: "text-error", review_requested: "text-accent",
};

const taskStatusStyles: Record<string, string> = {
  in_progress: "bg-accent/15 text-accent", in_review: "bg-yellow-500/15 text-yellow-500",
  done: "bg-green-500/15 text-green-500", todo: "bg-zinc-500/15 text-content-tertiary",
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

function TokenBar({ input, output, cache }: { input: number; output: number; cache: number }) {
  const total = input + output + cache;
  if (!total) return <div className="h-2 bg-surface-tertiary rounded-full" />;
  const iPct = (input / total) * 100;
  const oPct = (output / total) * 100;
  return (
    <div className="h-2 rounded-full overflow-hidden flex bg-surface-tertiary">
      <div className="bg-accent/80" style={{ width: `${iPct}%` }} />
      <div className="bg-accent/45" style={{ width: `${oPct}%` }} />
      <div className="bg-accent/15" style={{ flex: 1 }} />
    </div>
  );
}

function LifecycleBar({ createdAt, lastActiveAt }: { createdAt: string; lastActiveAt: string | null }) {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const maxLife = 24 * 60 * 60 * 1000;
  const pct = Math.min(((now - created) / maxLife) * 100, 100);

  return (
    <div>
      <div className="flex justify-between text-[10px] text-content-tertiary font-mono mb-1">
        <span>Created {formatRelative(createdAt)}</span>
        <span>Expires in {formatRelative(new Date(created + maxLife).toISOString())}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
        <div className="h-full rounded-full bg-accent/30" style={{ width: `${pct}%` }} />
      </div>
      {lastActiveAt && (
        <div className="text-[10px] text-content-tertiary font-mono mt-1">
          Last active {formatRelative(lastActiveAt)}
        </div>
      )}
    </div>
  );
}

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<any>(null);
  const [machine, setMachine] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.agents.get(id).then((a) => {
      setAgent(a);
      if (a.machine_id) api.machines.get(a.machine_id).then(setMachine).catch(() => {});
      api.tasks.list({ assigned_to: id }).then(setTasks).catch(() => {});
    }).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.agents.get(id).then(setAgent);
      api.tasks.list({ assigned_to: id }).then(setTasks).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-5xl mx-auto p-8 space-y-4">
          <div className="h-6 w-48 bg-surface-tertiary rounded animate-pulse" />
          <div className="h-48 bg-surface-secondary border border-border rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="max-w-5xl mx-auto p-8">
          <p className="text-content-secondary text-sm">Agent not found.</p>
        </div>
      </div>
    );
  }

  const colorRgb = agent.public_key ? agentColorRgb(agent.public_key) : "34, 211, 238";
  const isWorking = agent.status === "working";
  const activeTasks = tasks.filter((t: any) => t.status === "in_progress" || t.status === "in_review");
  const completedTasks = tasks.filter((t: any) => t.status === "done");
  const totalTokens = agent.input_tokens + agent.output_tokens + agent.cache_read_tokens;
  const grantedCaps = ["claim_task", "complete_task", "review_task", "send_message", "read_task"];

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-5xl mx-auto p-8 space-y-5">
        <div className="flex items-center gap-2 text-xs text-content-tertiary">
          <Link to="/agents" className="hover:text-content-secondary transition-colors">Agents</Link>
          <span>/</span>
          <span className="text-content-secondary">{agent.name}</span>
        </div>

        {/* ─── Identity Card ─── */}
        <div
          className={`bg-surface-secondary rounded-lg p-6 border transition-all ${isWorking ? "animate-breathe" : ""}`}
          style={{
            borderColor: isWorking ? `rgba(${colorRgb}, 0.3)` : "var(--border)",
            "--breathe-shadow-max": `0 0 40px rgba(${colorRgb}, 0.15), 0 0 80px rgba(${colorRgb}, 0.06)`,
            "--breathe-shadow-min": `0 0 16px rgba(${colorRgb}, 0.05), 0 0 32px rgba(${colorRgb}, 0.02)`,
          } as React.CSSProperties}
        >
          <div className="flex items-start gap-5">
            <AgentIdenticon publicKey={agent.public_key} size={72} glow={isWorking} />
            <div className="flex-1 min-w-0">
              <h1 className="font-mono text-2xl text-accent font-bold tracking-tight">{agent.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${statusDotColors[agent.status]}`} />
                  <span className="text-xs text-content-secondary">{statusLabels[agent.status]}</span>
                </span>
                {agent.public_key && (
                  <>
                    <span className="text-content-tertiary">·</span>
                    <span className="font-mono text-xs text-content-tertiary tracking-wider">
                      {agentFingerprint(agent.public_key)}
                    </span>
                  </>
                )}
              </div>

              {/* Machine info */}
              {machine && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/machines/${machine.id}`}
                    className="inline-flex items-center gap-1.5 text-xs hover:text-content-secondary transition-colors bg-surface-tertiary/50 rounded px-2 py-1"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${machine.status === "online" ? "bg-success" : "bg-warning"}`} />
                    <span className="font-mono text-content-secondary">{machine.name}</span>
                  </Link>
                  {machine.os && (
                    <span className="text-[10px] text-content-tertiary bg-surface-tertiary/50 rounded px-2 py-1">{machine.os}</span>
                  )}
                  {machine.version && (
                    <span className="text-[10px] text-content-tertiary font-mono bg-surface-tertiary/50 rounded px-2 py-1">v{machine.version}</span>
                  )}
                  {machine.runtimes && machine.runtimes.split(",").map((rt: string) => (
                    <span key={rt} className="text-[10px] font-mono text-accent bg-accent-soft rounded px-2 py-1">{rt.trim()}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Lifecycle */}
          <div className="mt-5">
            <LifecycleBar createdAt={agent.created_at} lastActiveAt={agent.last_active_at} />
          </div>
        </div>

        {/* ─── Active Tasks ─── */}
        {activeTasks.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-2">
              Active Tasks <span className="font-mono text-accent ml-1">{activeTasks.length}</span>
            </div>
            <div className="space-y-2">
              {activeTasks.map((task: any) => (
                <Link
                  key={task.id}
                  to={`/boards/${task.board_id}`}
                  className="flex items-center gap-3 bg-surface-secondary border border-accent/20 rounded-lg px-4 py-3 hover:border-accent/40 transition-colors"
                >
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${taskStatusStyles[task.status]}`}>
                    {task.status.replace("_", " ")}
                  </span>
                  <span className="text-sm text-content-primary flex-1 truncate">{task.title}</span>
                  {task.pr_url && (
                    <a href={task.pr_url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="text-[11px] font-mono text-accent px-2 py-0.5 rounded bg-accent-soft hover:underline">PR</a>
                  )}
                  {task.repository_name && (
                    <span className="text-[10px] font-mono text-content-tertiary">{task.repository_name}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ─── Stats ─── */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-secondary border border-border rounded-lg p-4 col-span-2">
            <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-3">Token Usage</div>
            <div className="grid grid-cols-3 gap-6 mb-3">
              <div>
                <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Input</span>
                <span className="font-mono text-xl text-content-primary">{formatTokens(agent.input_tokens)}</span>
              </div>
              <div>
                <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Output</span>
                <span className="font-mono text-xl text-content-primary">{formatTokens(agent.output_tokens)}</span>
              </div>
              <div>
                <span className="text-[10px] text-content-tertiary uppercase tracking-wider block mb-0.5">Cache</span>
                <span className="font-mono text-xl text-content-primary">{formatTokens(agent.cache_read_tokens)}</span>
              </div>
            </div>
            <TokenBar input={agent.input_tokens} output={agent.output_tokens} cache={agent.cache_read_tokens} />
            <div className="flex justify-between mt-1.5 text-[10px] text-content-tertiary font-mono">
              <span>{formatTokens(totalTokens)} total</span>
              <span>{formatCost(agent.cost_micro_usd)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="bg-surface-secondary border border-border rounded-lg p-4">
              <div className="text-[10px] text-content-tertiary uppercase tracking-wider mb-1">Tasks</div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl text-content-primary">{agent.task_count}</span>
                {completedTasks.length > 0 && <span className="text-[11px] text-success font-mono">{completedTasks.length} done</span>}
                {activeTasks.length > 0 && <span className="text-[11px] text-accent font-mono">{activeTasks.length} active</span>}
              </div>
            </div>
            <div className="bg-surface-secondary border border-border rounded-lg p-4">
              <div className="text-[10px] text-content-tertiary uppercase tracking-wider mb-1">Cost</div>
              <span className="font-mono text-2xl text-content-primary">{formatCost(agent.cost_micro_usd)}</span>
              {totalTokens > 0 && (
                <div className="text-[10px] text-content-tertiary font-mono mt-1">
                  {formatCost(Math.round(agent.cost_micro_usd / (totalTokens / 1000)))} / 1K tokens
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Capabilities ─── */}
        <div className="bg-surface-secondary border border-border rounded-lg p-4">
          <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-3">Capabilities</div>
          <div className="flex flex-wrap gap-2">
            {CAPABILITIES.map((cap) => {
              const granted = grantedCaps.includes(cap.name);
              return (
                <span
                  key={cap.name}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-mono ${
                    granted ? "bg-accent-soft text-accent" : "bg-surface-tertiary text-content-tertiary opacity-50"
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full ${granted ? "bg-accent" : "bg-content-tertiary"}`} />
                  {cap.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* ─── Completed Tasks ─── */}
        {completedTasks.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-2">Completed Tasks</div>
            <div className="space-y-1.5">
              {completedTasks.slice(0, 5).map((task: any) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="text-success text-[11px] font-mono">done</span>
                  <span className="text-content-secondary flex-1 truncate">{task.title}</span>
                  {task.pr_url && (
                    <a href={task.pr_url} target="_blank" rel="noopener" className="text-[11px] font-mono text-accent hover:underline">PR</a>
                  )}
                </div>
              ))}
              {completedTasks.length > 5 && (
                <span className="text-[11px] text-content-tertiary px-4">+{completedTasks.length - 5} more</span>
              )}
            </div>
          </div>
        )}

        {/* ─── Activity ─── */}
        <div>
          <div className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider mb-2">Activity</div>
          {(!agent.logs || agent.logs.length === 0) ? (
            <p className="text-sm text-content-tertiary">No activity yet.</p>
          ) : (
            <div className="space-y-0">
              {agent.logs.map((log: any) => (
                <div
                  key={log.id}
                  className={`flex gap-3 py-2 border-l-2 pl-4 ml-1 ${actionStyles[log.action] ? "border-accent" : "border-border"}`}
                >
                  <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                    {formatRelative(log.created_at)}
                  </span>
                  <span className={`text-[13px] ${actionStyles[log.action] || "text-content-secondary"}`}>
                    {log.action}
                  </span>
                  {log.task_title && (
                    <span className="text-[12px] text-content-tertiary truncate ml-auto">{log.task_title}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
