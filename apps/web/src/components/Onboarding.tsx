import { useState } from "react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { AddMachineSteps } from "./AddMachineSteps";

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [boardName, setBoardName] = useState("My Board");
  const [apiKeyDisplay, setApiKeyDisplay] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateBoard() {
    setLoading(true);
    setError("");
    await api.boards.create({ name: boardName });

    const { data, error: keyError } = await authClient.apiKey.create({ name: "onboarding" });
    if (keyError || !data?.key) {
      setError("Failed to create API key. You can create one later from Machines page.");
      setLoading(false);
      return;
    }
    setApiKeyDisplay(data.key);
    setApiKeyId(data.id);

    setLoading(false);
    setStep(1);
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
          {[0, 1].map((s) => (
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
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <Button
              onClick={handleCreateBoard}
              disabled={loading || !boardName.trim()}
              className="w-full"
            >
              {loading ? "Creating..." : "Create Board"}
            </Button>
          </div>
        )}

        {step === 1 && apiKeyDisplay && apiKeyId && (
          <AddMachineSteps
            apiKey={apiKeyDisplay}
            apiKeyId={apiKeyId}
            onDone={onComplete}
          />
        )}
      </div>
    </div>
  );
}
