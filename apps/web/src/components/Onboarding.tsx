import { useState } from "react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [boardName, setBoardName] = useState("My Board");
  const [taskTitle, setTaskTitle] = useState("First task");
  const [apiKeyDisplay, setApiKeyDisplay] = useState("");
  const [apiUrl, setApiUrl] = useState(window.location.origin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateBoard() {
    setLoading(true);
    await api.boards.create({ name: boardName });
    setLoading(false);
    setStep(1);
  }

  async function handleCreateTask() {
    setLoading(true);
    setError("");
    await api.tasks.create({ title: taskTitle, priority: "high" });

    const { data, error: keyError } = await authClient.apiKey.create({ name: "onboarding" });
    if (keyError || !data?.key) {
      setError("Failed to create API key. You can create one later from Machines page.");
      setLoading(false);
      return;
    }
    setApiKeyDisplay(data.key);

    setLoading(false);
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
            <Input
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
            />
            <Button
              onClick={handleCreateBoard}
              disabled={loading || !boardName.trim()}
              className="w-full"
            >
              {loading ? "Creating..." : "Create Board"}
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">
              First task
            </label>
            <Input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <Button
              onClick={handleCreateTask}
              disabled={loading || !taskTitle.trim()}
              className="w-full"
            >
              {loading ? "Creating..." : "Create Task"}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">
              CLI configuration
            </label>
            <pre className="bg-surface-primary border border-border rounded-lg p-3 text-xs font-mono text-content-secondary overflow-x-auto">
{`npx agent-kanban start --api-url ${apiUrl} --api-key ${apiKeyDisplay}`}
            </pre>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(
                `npx agent-kanban start --api-url ${apiUrl} --api-key ${apiKeyDisplay}`
              )}
              className="w-full"
            >
              Copy to clipboard
            </Button>
            <Button
              onClick={handleDone}
              className="w-full"
            >
              Go to Board
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
