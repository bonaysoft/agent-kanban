import { useAgent } from "../hooks/useAgents";
import { agentFingerprint } from "../lib/agentIdentity";
import { AgentIdenticon } from "./AgentIdenticon";
import { formatRelative } from "./TaskDetailFields";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

interface AgentProfileProps {
  agentId: string;
  onClose: () => void;
  onTaskClick: (taskId: string) => void;
}

const statusDotColors: Record<string, string> = {
  online: "bg-accent animate-pulse-glow",
  offline: "bg-content-tertiary",
};

const statusLabels: Record<string, string> = {
  online: "Online",
  offline: "Offline",
};

const actionStyles: Record<string, string> = {
  claimed: "text-accent",
  assigned: "text-accent",
  completed: "text-success",
  released: "text-warning",
  timed_out: "text-error",
};

export function AgentProfile({ agentId, onClose, onTaskClick }: AgentProfileProps) {
  const { agent, loading } = useAgent(agentId);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent showCloseButton={false} className="overflow-y-auto p-0 gap-0">
        <SheetTitle className="sr-only">Agent profile</SheetTitle>
        <SheetDescription className="sr-only">Agent details and activity</SheetDescription>

        {loading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : !agent ? (
          <div className="p-6">
            <p className="text-content-secondary">Agent not found.</p>
          </div>
        ) : (
          <>
            <div className="p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <AgentIdenticon publicKey={agent.public_key} size={40} />
                <div>
                  <h2 className="font-mono text-lg text-accent font-semibold">{agent.name}</h2>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDotColors[agent.status]}`} />
                    <span className="text-xs text-content-secondary">{statusLabels[agent.status] || agent.status}</span>
                  </div>
                  {agent.fingerprint && <span className="font-mono text-[10px] text-content-tertiary">{agentFingerprint(agent.fingerprint)}</span>}
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Tasks</div>
                  <span className="font-mono text-content-primary">{agent.task_count}</span>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-1">Last Active</div>
                  <span className="font-mono text-content-primary text-[13px]">
                    {agent.last_active_at ? formatRelative(agent.last_active_at) : "—"}
                  </span>
                </div>
              </div>

              <Separator />

              <div>
                <div className="text-[11px] font-medium text-content-tertiary uppercase tracking-wide mb-2">Activity</div>
                <div className="space-y-0 max-h-96 overflow-y-auto">
                  {(agent.logs || []).map((log: any) => (
                    <div key={log.id} className="flex gap-3 py-2 border-l-2 pl-4 ml-1 border-border">
                      <span className="font-mono text-[11px] text-content-tertiary whitespace-nowrap min-w-[50px]">
                        {formatRelative(log.created_at)}
                      </span>
                      <span className={`text-[13px] ${actionStyles[log.action] || "text-content-secondary"}`}>{log.action}</span>
                      {log.task_title && (
                        <Button
                          variant="link"
                          size="xs"
                          onClick={() => onTaskClick(log.task_id)}
                          className="text-[12px] text-content-tertiary truncate ml-auto px-0"
                        >
                          {log.task_title}
                        </Button>
                      )}
                    </div>
                  ))}
                  {(!agent.logs || agent.logs.length === 0) && <p className="text-sm text-content-tertiary">No activity yet.</p>}
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
