import { AuiIf, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, ThreadPrimitive, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ArrowDownIcon, ArrowUpIcon, Plug, SquareIcon, Wrench } from "lucide-react";
import type { FC } from "react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning, ReasoningGroup } from "@/components/assistant-ui/reasoning";
import { Mono, parseMcpToolName, ToolShell } from "./tool-uis";

// ─── Props ───

interface AgentThreadProps {
  taskDone: boolean;
}

// ─── Thread Root ───

export const AgentThread: FC<AgentThreadProps> = ({ taskDone }) => {
  return (
    <ThreadPrimitive.Root className="aui-root aui-thread-root flex h-full flex-col">
      <ThreadPrimitive.Viewport className="aui-thread-viewport flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth px-1">
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

// ─── Generic Tool Fallback ──────────────────────────────────────────────────
// Routes through the same ToolShell as per-tool UIs. For MCP tools it parses
// the `mcp__namespace__name` convention and renders a cleaner header.

export const ChatToolFallback: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const mcp = parseMcpToolName(toolName);
  const icon = mcp ? <Plug className="size-3.5" /> : <Wrench className="size-3.5" />;
  const label = mcp ? `mcp:${mcp.ns}` : "tool";
  const summary = mcp ? mcp.name : toolName;
  const resultText = result == null ? null : typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return (
    <ToolShell icon={icon} label={label} status={status} summary={summary}>
      {argsText && (
        <>
          <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-content-tertiary">args</div>
          <Mono>{argsText}</Mono>
        </>
      )}
      {resultText != null && (
        <>
          <div className="mt-1.5 mb-1 text-[10px] font-mono uppercase tracking-wide text-content-tertiary">result</div>
          <Mono>{resultText}</Mono>
        </>
      )}
    </ToolShell>
  );
};

// ─── Assistant Message ───

const AgentMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-assistant-message-root relative w-full py-2">
      <div className="flex flex-col gap-2 text-sm text-content-primary leading-relaxed [&_.aui-reasoning-root]:mb-1 [&_.aui-reasoning-root]:border-0 [&_.aui-reasoning-root]:px-0 [&_.aui-reasoning-root]:py-0">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: Reasoning,
            ReasoningGroup: ReasoningGroup,
            tools: { Fallback: ChatToolFallback },
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
    <MessagePrimitive.Root className="aui-user-message-root flex justify-end w-full py-2">
      <div className="max-w-[80%] rounded-2xl bg-accent/10 border border-accent/20 px-4 py-2.5 text-sm text-content-primary">
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
