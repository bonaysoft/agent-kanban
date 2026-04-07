import { AuiIf, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowDownIcon, ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FC } from "react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { RelayRuntimeProvider } from "./RelayRuntimeProvider";

// ─── Props ───

interface ChatPanelProps {
  taskId: string;
  agentId: string | null;
  sessionId: string | null;
  userId: string | null;
  taskDone: boolean;
}

// ─── Main Export ───

export function ChatPanel({ taskId, agentId, sessionId, userId, taskDone }: ChatPanelProps) {
  if (!agentId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-content-tertiary">No agent assigned. Chat is available when an agent is working on this task.</p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <p className="text-sm text-content-tertiary text-center">Chat history is not available for this task.</p>
      </div>
    );
  }

  return (
    <RelayRuntimeProvider sessionId={sessionId} userId={userId} taskDone={taskDone}>
      <AgentThread taskDone={taskDone} />
    </RelayRuntimeProvider>
  );
}

// ─── Thread ───

const AgentThread: FC<{ taskDone: boolean }> = ({ taskDone }) => {
  return (
    <ThreadPrimitive.Root className="aui-root aui-thread-root flex h-full flex-col">
      <ThreadPrimitive.Viewport className="aui-thread-viewport flex flex-1 flex-col gap-1 overflow-y-auto scroll-smooth">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-content-tertiary">{taskDone ? "No activity recorded." : "Waiting for agent activity..."}</p>
          </div>
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{
            AssistantMessage: AgentMessage,
            UserMessage: HumanMessage,
          }}
        />

        {!taskDone && (
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto flex w-full flex-col gap-2 bg-background pt-2">
            <ScrollToBottom />
            <AgentComposer />
          </ThreadPrimitive.ViewportFooter>
        )}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

// ─── Assistant Message ───

const AgentMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-assistant-message-root relative w-full py-1.5">
      <div className="text-sm text-content-primary leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: Reasoning,
            tools: { Fallback: ToolFallback },
          }}
        />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-1 rounded-md border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
            <ErrorPrimitive.Message className="line-clamp-2" />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
};

// ─── User Message ───

const HumanMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-user-message-root flex justify-end w-full py-1.5">
      <div className="max-w-[80%] rounded-2xl bg-accent/10 border border-accent/20 px-3 py-2 text-sm text-content-primary">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
};

// ─── Composer ───

const AgentComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="flex w-full gap-2">
      <ComposerPrimitive.Input
        placeholder="Message the agent..."
        className="flex-1 min-h-[36px] rounded-md border border-border bg-background px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        rows={1}
        aria-label="Message input"
      />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-background disabled:opacity-30">
          <ArrowUpIcon className="size-4" />
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-content-secondary">
          <SquareIcon className="size-3 fill-current" />
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
};

// ─── Scroll to Bottom ───

const ScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom className="absolute -top-10 z-10 self-center rounded-full border p-2 disabled:invisible">
      <ArrowDownIcon className="size-4" />
    </ThreadPrimitive.ScrollToBottom>
  );
};
