import { useState, useMemo } from "react";
import { Header } from "../components/Header";
import { FilterBar } from "../components/FilterBar";
import { KanbanColumn } from "../components/KanbanColumn";
import { TaskDetail } from "../components/TaskDetail";
import { AgentProfile } from "../components/AgentProfile";
import { Onboarding } from "../components/Onboarding";
import { useBoard } from "../hooks/useBoard";

export function BoardPage() {
  const { board, loading, error, refresh } = useBoard();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState(0);

  const projects = useMemo(() => {
    if (!board?.columns) return [];
    const set = new Set<string>();
    for (const col of board.columns) {
      for (const task of col.tasks) {
        if (task.project) set.add(task.project);
      }
    }
    return Array.from(set).sort();
  }, [board]);

  const filteredBoard = useMemo(() => {
    if (!board || !activeProject) return board;
    return {
      ...board,
      columns: board.columns.map((col: any) => ({
        ...col,
        tasks: col.tasks.filter((t: any) => t.project === activeProject),
      })),
    };
  }, [board, activeProject]);

  if (error === "NOT_AUTHENTICATED") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-bold text-content-primary">Agent <span className="text-accent">Kanban</span></h1>
          <p className="text-sm text-content-secondary">Enter your API key to continue.</p>
          <input
            type="password"
            placeholder="API key"
            className="w-64 bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                localStorage.setItem("api-key", (e.target as HTMLInputElement).value);
                refresh();
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <div className="grid grid-cols-3 gap-0 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="p-4 space-y-3">
              <div className="h-4 w-20 bg-surface-tertiary rounded animate-pulse" />
              {[0, 1].map((j) => (
                <div key={j} className="h-20 bg-surface-secondary border border-border rounded-lg animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <Header />
        <Onboarding onComplete={refresh} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header boardName={board.name} />
      <FilterBar projects={projects} activeProject={activeProject} onProjectChange={setActiveProject} />

      {error && (
        <div className="mx-5 mt-3 px-4 py-2 bg-error/10 border-l-2 border-error text-error text-sm rounded">
          {error}
          <button onClick={refresh} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Mobile tab switcher */}
      <div className="flex md:hidden border-b border-border">
        {(filteredBoard?.columns || []).map((col: any, i: number) => (
          <button
            key={col.id}
            onClick={() => setMobileTab(i)}
            className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide text-center transition-colors ${
              mobileTab === i ? "text-accent border-b-2 border-accent" : "text-content-tertiary"
            }`}
          >
            {col.name} ({col.tasks.length})
          </button>
        ))}
      </div>

      {/* Desktop: 3-column grid */}
      <div className="hidden md:grid grid-cols-3 min-h-[calc(100vh-100px)]">
        {(filteredBoard?.columns || []).map((col: any) => (
          <KanbanColumn
            key={col.id}
            column={col}
            onTaskClick={setSelectedTask}
            onAgentClick={setSelectedAgent}
            onRefresh={refresh}
          />
        ))}
      </div>

      {/* Mobile: single column based on tab */}
      <div className="md:hidden min-h-[calc(100vh-160px)]">
        {(filteredBoard?.columns || []).filter((_: any, i: number) => i === mobileTab).map((col: any) => (
          <KanbanColumn
            key={col.id}
            column={col}
            onTaskClick={setSelectedTask}
            onAgentClick={setSelectedAgent}
            onRefresh={refresh}
          />
        ))}
      </div>

      {selectedTask && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedTask(null)}
          />
          <TaskDetail
            taskId={selectedTask}
            columns={(board?.columns || []).map((c: any) => ({ id: c.id, name: c.name }))}
            onClose={() => setSelectedTask(null)}
            onRefresh={refresh}
            onAgentClick={(agentId) => { setSelectedTask(null); setSelectedAgent(agentId); }}
          />
        </>
      )}

      {selectedAgent && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedAgent(null)}
          />
          <AgentProfile
            agentId={selectedAgent}
            onClose={() => setSelectedAgent(null)}
            onTaskClick={(taskId) => { setSelectedAgent(null); setSelectedTask(taskId); }}
          />
        </>
      )}
    </div>
  );
}
