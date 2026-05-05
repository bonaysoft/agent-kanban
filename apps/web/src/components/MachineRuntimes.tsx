import { type MachineRuntime, RUNTIME_LABELS } from "@agent-kanban/shared";
import { cn } from "../lib/utils";

const runtimeStatusStyles: Record<MachineRuntime["status"], { dot: string; text: string; label: string }> = {
  ready: {
    dot: "bg-success",
    text: "text-success",
    label: "Ready",
  },
  limited: {
    dot: "bg-warning",
    text: "text-warning",
    label: "Limited",
  },
  unauthorized: {
    dot: "bg-error",
    text: "text-error",
    label: "Unauthorized",
  },
  unhealthy: {
    dot: "bg-error",
    text: "text-error",
    label: "Unhealthy",
  },
  missing: {
    dot: "bg-content-tertiary",
    text: "text-content-tertiary",
    label: "Missing",
  },
};

function RuntimeStatus({ runtime }: { runtime: MachineRuntime }) {
  const style = runtimeStatusStyles[runtime.status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium", style.text)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

export function MachineRuntimeBadges({ runtimes }: { runtimes: MachineRuntime[] }) {
  if (runtimes.length === 0) {
    return <span className="text-[10px] font-mono text-content-tertiary">No runtimes</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {runtimes.map((runtime) => (
        <span key={runtime.name} className="inline-flex items-center gap-1.5 rounded bg-surface-tertiary px-2 py-1">
          <span className="font-mono text-[10px] text-content-primary">{RUNTIME_LABELS[runtime.name] ?? runtime.name}</span>
          <RuntimeStatus runtime={runtime} />
        </span>
      ))}
    </div>
  );
}

export function MachineRuntimeList({ runtimes }: { runtimes: MachineRuntime[] }) {
  if (runtimes.length === 0) {
    return <span className="text-[11px] font-mono text-content-tertiary">No runtimes detected</span>;
  }

  return (
    <div className="divide-y divide-border">
      {runtimes.map((runtime) => (
        <div key={runtime.name} className="grid gap-2 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <div className="font-mono text-xs text-content-primary">{RUNTIME_LABELS[runtime.name] ?? runtime.name}</div>
            {runtime.detail && <div className="mt-0.5 truncate text-[11px] text-content-tertiary">{runtime.detail}</div>}
          </div>
          <RuntimeStatus runtime={runtime} />
        </div>
      ))}
    </div>
  );
}
