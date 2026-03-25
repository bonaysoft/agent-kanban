import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSSE } from "../hooks/useSSE";
import { api } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { ActivityLog } from "./ActivityLog";
import { AgentIdenticon } from "./AgentIdenticon";
import { ChatPanel } from "./ChatPanel";
import { SubtaskList } from "./SubtaskList";
import { EditableText, Field, FieldLabel } from "./TaskDetailFields";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const REVIEW_ACTIONS = {
  reject: { label: "Reject", variant: "outline" as const },
  complete: { label: "Complete", variant: "default" as const },
};

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
  onRefresh: () => void;
  onAgentClick?: (agentId: string) => void;
}

const PRIORITY_CLASSES: Record<string, string> = {
  urgent: "bg-red-500/10 text-red-400 border-red-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export function TaskDetail({ taskId, onClose, onRefresh, onAgentClick: _onAgentClick }: TaskDetailProps) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const { notes: sseNotes, messages: sseMessages, reconnecting } = useSSE({ taskId, enabled: true });

  const { data: task, isLoading: loading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.tasks.get(taskId),
  });

  const { data: initialMessages = [] } = useQuery({
    queryKey: ["task-messages", taskId],
    queryFn: () => api.messages.list(taskId),
  });

  const { data: repositories = [] } = useQuery({
    queryKey: ["repositories"],
    queryFn: () => api.repositories.list(),
    staleTime: 60_000,
  });

  const dependsOn: string[] = task?.depends_on || [];

  const { data: depTitles = {} } = useQuery({
    queryKey: ["dep-titles", dependsOn],
    queryFn: async () => {
      const entries = await Promise.all(dependsOn.map((id) => api.tasks.get(id).then((t: any) => [id, t.title] as const)));
      return Object.fromEntries(entries);
    },
    enabled: dependsOn.length > 0,
  });

  async function reload() {
    await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
  }

  async function handleUpdate(field: string, value: string | null) {
    await api.tasks.update(taskId, { [field]: value });
    await reload();
    onRefresh();
  }

  async function handleReviewAction(action: "reject" | "complete") {
    if (action === "reject") await api.tasks.reject(taskId);
    else await api.tasks.complete(taskId);
    await reload();
    onRefresh();
  }

  const content = loading ? (
    <div className="p-6 space-y-4">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-20 w-full" />
    </div>
  ) : !task ? (
    <div className="p-6">
      <p className="text-content-secondary">Task not found.</p>
      <Button variant="link" onClick={onClose} className="mt-4">
        Back to board
      </Button>
    </div>
  ) : null;

  if (content) {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent showCloseButton={false}>
          <SheetTitle className="sr-only">Task</SheetTitle>
          <SheetDescription className="sr-only">Task details</SheetDescription>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  const repo = repositories.find((r: any) => r.id === task.repository_id);

  const agentDisplay = task.agent_name ? (
    <button className="flex items-center gap-1.5 cursor-pointer group" onClick={() => setChatOpen(true)} type="button">
      {task.agent_public_key && <AgentIdenticon publicKey={task.agent_public_key} size={20} />}
      <span className="font-mono text-[13px] text-accent group-hover:underline">{task.agent_name}</span>
    </button>
  ) : (
    <span className="text-content-tertiary">—</span>
  );

  const detailsContent = (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <FieldLabel>Status</FieldLabel>
          <span className="text-sm font-medium text-accent">{TASK_STATUS_LABELS[task.status] || task.status}</span>
        </div>
        <Field label="Assigned to" value={agentDisplay} />
        <Field
          label="Duration"
          value={
            task.duration_minutes != null ? (
              <span className="font-mono text-[13px]">{task.duration_minutes} min</span>
            ) : (
              <span className="text-content-tertiary">—</span>
            )
          }
        />
      </div>

      {task.status === "in_review" && (
        <div className="flex gap-2">
          {(Object.entries(REVIEW_ACTIONS) as [keyof typeof REVIEW_ACTIONS, (typeof REVIEW_ACTIONS)[keyof typeof REVIEW_ACTIONS]][]).map(
            ([action, config]) => (
              <Button key={action} variant={config.variant} size="sm" onClick={() => handleReviewAction(action)}>
                {config.label}
              </Button>
            ),
          )}
        </div>
      )}

      {dependsOn.length > 0 && (
        <div>
          <FieldLabel>Depends on</FieldLabel>
          <div className="flex gap-1.5 flex-wrap">
            {dependsOn.map((depId) => (
              <Badge key={depId} variant="secondary" className="text-[11px] font-mono">
                {depTitles[depId] || depId}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <FieldLabel>Description</FieldLabel>
        {task.description ? (
          <div className="overflow-x-auto prose-sm text-[13px] text-content-secondary [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-content-primary [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-content-primary [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-content-primary [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-2 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:mb-0.5 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_pre]:bg-surface-primary [&_pre]:border [&_pre]:border-border [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:font-mono [&_pre]:text-[12px] [&_code]:font-mono [&_code]:text-accent [&_code]:bg-surface-primary [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px] [&_pre_code]:bg-transparent [&_pre_code]:text-content-secondary [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-content-tertiary [&_th]:uppercase [&_th]:tracking-wide [&_th]:border-b [&_th]:border-border [&_th]:pb-1 [&_td]:border-b [&_td]:border-border [&_td]:py-1 [&_td]:pr-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-content-tertiary [&_hr]:border-border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-[13px] text-content-tertiary">No description.</p>
        )}
      </div>

      {task.input && (
        <div>
          <FieldLabel>Input</FieldLabel>
          <pre className="text-xs font-mono bg-surface-primary border border-border rounded-md p-3 text-content-secondary overflow-x-auto">
            {JSON.stringify(task.input, null, 2)}
          </pre>
        </div>
      )}

      {task.result && (
        <div>
          <FieldLabel>Result</FieldLabel>
          <p className="text-sm text-content-secondary">{task.result}</p>
        </div>
      )}

      {task.pr_url && (
        <div>
          <FieldLabel>PR</FieldLabel>
          <a href={task.pr_url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
            {task.pr_url}
          </a>
        </div>
      )}

      {task.subtask_count > 0 && (
        <>
          <Separator />
          <div>
            <FieldLabel>Subtasks ({task.subtask_count})</FieldLabel>
            <SubtaskList
              parentId={taskId}
              onTaskClick={(_id) => {
                /* navigate to subtask */
              }}
            />
          </div>
        </>
      )}

      <Separator />

      <div>
        <FieldLabel>Activity</FieldLabel>
        <ActivityLog initialNotes={task.notes || []} sseNotes={sseNotes} reconnecting={reconnecting} />
      </div>

      <Separator />
    </div>
  );

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent showCloseButton={false} className="overflow-y-auto p-0 gap-0">
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <SheetDescription className="sr-only">Task detail panel</SheetDescription>

          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-border">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <EditableText value={task.title} onSave={(v) => handleUpdate("title", v)} className="text-lg font-semibold text-content-primary" />
                {task.blocked && (
                  <Badge variant="destructive" className="text-[10px] font-mono font-semibold uppercase">
                    Blocked
                  </Badge>
                )}
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {repo && (
                  <Badge variant="secondary" className="text-[11px] font-mono">
                    {repo.name}
                  </Badge>
                )}
                {task.priority && PRIORITY_CLASSES[task.priority] && (
                  <Badge className={`text-[11px] font-mono border ${PRIORITY_CLASSES[task.priority]}`}>{task.priority}</Badge>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              ✕
            </Button>
          </div>

          {detailsContent}
        </SheetContent>
      </Sheet>

      {/* Nested chat drawer — overlays on top of task detail */}
      {task.assigned_to && (
        <Sheet open={chatOpen} onOpenChange={(open) => setChatOpen(open)}>
          <SheetContent showCloseButton={false} className="flex flex-col p-0 gap-0 z-[60]">
            <SheetTitle className="sr-only">Chat with {task.agent_name}</SheetTitle>
            <SheetDescription className="sr-only">Chat panel</SheetDescription>

            {/* Chat drawer header */}
            <div className="flex items-center gap-3 p-4 border-b border-border shrink-0">
              {task.agent_public_key && <AgentIdenticon publicKey={task.agent_public_key} size={28} />}
              <span className="font-mono text-[13px] text-accent flex-1">{task.agent_name}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setChatOpen(false)}>
                ✕
              </Button>
            </div>

            {/* Chat panel body */}
            <div className="flex flex-col flex-1 min-h-0 p-4">
              <ChatPanel
                taskId={taskId}
                agentId={task.assigned_to}
                userId={session?.user?.id || null}
                taskDone={task.status === "done" || task.status === "cancelled"}
                initialMessages={initialMessages}
                sseMessages={sseMessages}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
