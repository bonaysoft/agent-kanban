import { useState } from "react";
import { api } from "../lib/api";

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [boardName, setBoardName] = useState("My Board");
  const [taskTitle, setTaskTitle] = useState("Fix auth bug in project-a");
  const [taskProject, setTaskProject] = useState("project-a");
  const [apiKeyDisplay, setApiKeyDisplay] = useState("");
  const [apiUrl, setApiUrl] = useState(window.location.origin);
  const [loading, setLoading] = useState(false);

  async function handleCreateBoard() {
    setLoading(true);
    await api.boards.create(boardName);
    setLoading(false);
    setStep(1);
  }

  async function handleCreateTask() {
    setLoading(true);
    await api.tasks.create({ title: taskTitle, project: taskProject, priority: "high" });
    setLoading(false);
    setApiKeyDisplay(localStorage.getItem("api-key") || "");
    setStep(2);
  }

  function handleDone() {
    onComplete();
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-content-primary">
            Agent <span className="text-accent">Kanban</span>
          </h1>
          <p className="text-sm text-content-secondary mt-2">
            Your AI workforce starts here.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-2">
          {[0, 1, 2].map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full ${s <= step ? "bg-accent" : "bg-surface-tertiary"}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">
              Board name
            </label>
            <input
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
            />
            <button
              onClick={handleCreateBoard}
              disabled={loading || !boardName.trim()}
              className="w-full bg-accent text-[#09090B] font-medium text-sm py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Board"}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">
              First task
            </label>
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent"
            />
            <input
              value={taskProject}
              onChange={(e) => setTaskProject(e.target.value)}
              placeholder="Project name"
              className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2.5 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
            />
            <button
              onClick={handleCreateTask}
              disabled={loading || !taskTitle.trim()}
              className="w-full bg-accent text-[#09090B] font-medium text-sm py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Task"}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">
              CLI configuration
            </label>
            <pre className="bg-surface-primary border border-border rounded-lg p-3 text-xs font-mono text-content-secondary overflow-x-auto">
{`agent-kanban config set api-url ${apiUrl}
agent-kanban config set api-key ${apiKeyDisplay}`}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(
                `agent-kanban config set api-url ${apiUrl}\nagent-kanban config set api-key ${apiKeyDisplay}`
              )}
              className="w-full border border-border text-content-secondary font-medium text-sm py-2.5 rounded-lg hover:border-content-tertiary"
            >
              Copy to clipboard
            </button>
            <button
              onClick={handleDone}
              className="w-full bg-accent text-[#09090B] font-medium text-sm py-2.5 rounded-lg hover:opacity-90"
            >
              Go to Board
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
