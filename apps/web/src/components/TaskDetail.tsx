import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { useSession } from "../lib/auth-client";
import { getAllowedActions, type TaskTransition } from "@agent-kanban/shared";
import { EditableText, EditableTextarea, Field, FieldLabel } from "./TaskDetailFields";
import { ActivityLog } from "./ActivityLog";
import { ChatPanel } from "./ChatPanel";
import { SubtaskList } from "./SubtaskList";
import { AssignDropdown } from "./AssignDropdown";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet";
import { Badge } from "./ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const ACTION_LABELS: Record<TaskTransition, string> = {
  claim: "Claim",
  review: "Request Review",
  reject: "Reject",
  complete: "Complete",
  cancel: "Cancel",
  release: "Release",
};

const ACTION_VARIANTS: Record<TaskTransition, "default" | "destructive" | "outline"> = {
  claim: "default",
  review: "default",
  reject: "outline",
  complete: "default",
  cancel: "destructive",
  release: "outline",
};

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
  onRefresh: () => void;
  onAgentClick?: (agentId: string) => void;
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export function TaskDetail({ taskId, onClose, onRefresh, onAgentClick }: TaskDetailProps) {
  const { data: session } = useSession();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [repositories, setRepositories] = useState<{ id: string; name: string }[]>([]);
  const [depTitles, setDepTitles] = useState<Record<string, string>>({});
  const [initialMessages, setInitialMessages] = useState<any[]>([]);
  const { messages: sseMessages } = useSSE({ taskId, enabled: true });

  const reload = () => api.tasks.get(taskId).then(setTask);

  useEffect(() => {
    reload().finally(() => setLoading(false));
    api.messages.list(taskId).then(setInitialMessages).catch(() => {});
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

  async function handleAction(action: TaskTransition) {
    const handlers: Record<TaskTransition, () => Promise<any>> = {
      claim: () => api.tasks.claim(taskId),
      review: () => api.tasks.review(taskId),
      reject: () => api.tasks.reject(taskId),
      complete: () => api.tasks.complete(taskId),
      cancel: () => api.tasks.cancel(taskId),
      release: () => api.tasks.release(taskId),
    };
    await handlers[action]();
    await reload();
    onRefresh();
  }

  async function handleDelete() {
    await api.tasks.delete(taskId);
    onClose();
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
      <Button variant="link" onClick={onClose} className="mt-4">Back to board</Button>
    </div>
  ) : null;

  if (content) {
    return (
      <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent showCloseButton={false}>
          <SheetTitle className="sr-only">Task</SheetTitle>
          <SheetDescription className="sr-only">Task details</SheetDescription>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  const dependsOn: string[] = task.depends_on || [];
  const hasAgent = !!task.assigned_to;

  const detailsContent = (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <FieldLabel>Status</FieldLabel>
          <span className="text-sm font-medium text-accent">{TASK_STATUS_LABELS[task.status] || task.status}</span>
        </div>
        <div>
          <FieldLabel>Assigned to</FieldLabel>
          <AssignDropdown
            taskId={taskId}
            taskStatus={task.status}
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

      {(() => {
        const actions = getAllowedActions(task.status, "user");
        if (actions.length === 0) return null;
        return (
          <div className="flex gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                variant={ACTION_VARIANTS[action]}
                size="sm"
                onClick={() => handleAction(action)}
              >
                {ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        );
      })()}

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
        <EditableTextarea
          value={task.description || ""}
          placeholder="Add a description..."
          onSave={(v) => handleUpdate("description", v || null)}
        />
      </div>

      {task.input && (
        <div>
          <FieldLabel>Input</FieldLabel>
          <pre className="text-xs font-mono bg-surface-primary border border-border rounded-md p-3 text-content-secondary overflow-x-auto">
            {JSON.stringify(JSON.parse(task.input), null, 2)}
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
            <SubtaskList parentId={taskId} onTaskClick={(id) => { /* navigate to subtask */ }} />
          </div>
        </>
      )}

      <Separator />

      <div>
        <FieldLabel>Activity</FieldLabel>
        <ActivityLog
          taskId={taskId}
          initialLogs={task.logs || []}
          assigned={!!task.assigned_to}
        />
      </div>

      <Separator />

      {((task.status === "todo" && !task.assigned_to) || task.status === "cancelled") && (
        <Button variant="destructive" size="xs" onClick={handleDelete}>
          Delete task
        </Button>
      )}
    </div>
  );

  const chatContent = (
    <div className="flex flex-col h-[calc(100%-8rem)] p-5">
      <ChatPanel
        taskId={taskId}
        agentId={task.assigned_to}
        userId={session?.user?.id || null}
        taskDone={task.status === "done" || task.status === "cancelled"}
        initialMessages={initialMessages}
        sseMessages={sseMessages}
      />
    </div>
  );

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent showCloseButton={false} className="overflow-y-auto p-0 gap-0">
        <SheetTitle className="sr-only">{task.title}</SheetTitle>
        <SheetDescription className="sr-only">Task detail panel</SheetDescription>

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
                <Badge variant="destructive" className="text-[10px] font-mono font-semibold uppercase">
                  Blocked
                </Badge>
              )}
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <Select value={task.repository_id || "__none__"} onValueChange={(v) => handleUpdate("repository_id", v === "__none__" ? null : v)}>
                <SelectTrigger size="sm" className="text-[11px] font-mono h-6">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">no repo</SelectItem>
                  {repositories.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={task.priority || "__none__"} onValueChange={(v) => handleUpdate("priority", v === "__none__" ? null : v)}>
                <SelectTrigger size="sm" className="text-[11px] font-mono h-6">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">no priority</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>✕</Button>
        </div>

        {hasAgent ? (
          <Tabs defaultValue="details">
            <TabsList variant="line" className="w-full justify-start border-b border-border px-5">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
            </TabsList>
            <TabsContent value="details">{detailsContent}</TabsContent>
            <TabsContent value="chat">{chatContent}</TabsContent>
          </Tabs>
        ) : (
          detailsContent
        )}
      </SheetContent>
    </Sheet>
  );
}
