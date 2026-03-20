import { useState, useMemo } from "react";
import { Header } from "../components/Header";
import { FilterBar } from "../components/FilterBar";
import { KanbanColumn } from "../components/KanbanColumn";
import { TaskDetail } from "../components/TaskDetail";
import { Onboarding } from "../components/Onboarding";
import { useBoard } from "../hooks/useBoard";

export function BoardPage() {
  const { board, loading, error, refresh } = useBoard();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);

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

      <div className="grid grid-cols-3 min-h-[calc(100vh-100px)]">
        {(filteredBoard?.columns || []).map((col: any) => (
          <KanbanColumn
            key={col.id}
            column={col}
            onTaskClick={setSelectedTask}
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
          />
        </>
      )}
    </div>
  );
}
