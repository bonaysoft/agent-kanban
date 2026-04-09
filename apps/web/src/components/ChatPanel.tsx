import { AgentThread, ChatToolUIs } from "@/components/chat";
import { RelayRuntimeProvider } from "./RelayRuntimeProvider";

interface ChatPanelProps {
  taskId: string;
  agentId: string | null;
  sessionId: string | null;
  userId: string | null;
  taskDone: boolean;
}

export function ChatPanel({ agentId, sessionId, userId, taskDone }: ChatPanelProps) {
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
      <ChatToolUIs />
      <AgentThread taskDone={taskDone} />
    </RelayRuntimeProvider>
  );
}
