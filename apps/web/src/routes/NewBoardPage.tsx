import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AddMachineSteps } from "../components/AddMachineSteps";
import { Header } from "../components/Header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useCreateBoard } from "../hooks/useBoard";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";

export function NewBoardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [boardName, setBoardName] = useState("My Board");
  const [boardType, setBoardType] = useState<"dev" | "ops">("dev");
  const [apiKeyDisplay, setApiKeyDisplay] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [error, setError] = useState("");
  const createBoard = useCreateBoard();

  async function handleCreateBoard() {
    setError("");
    await createBoard.mutateAsync({ name: boardName, type: boardType });

    const { data, error: keyError } = await authClient.apiKey.create({ name: "onboarding" });
    if (keyError || !data?.key) {
      setError("Failed to create API key. You can create one later from Machines page.");
      return;
    }
    setApiKeyDisplay(data.key);
    setApiKeyId(data.id);
    setStep(1);
  }

  async function handleDone() {
    const boards = await api.boards.list();
    if (boards.length > 0) navigate(`/boards/${boards[0].id}`, { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full space-y-6 p-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-content-primary">
              Agent <span className="text-accent">Kanban</span>
            </h1>
            <p className="text-sm text-content-secondary mt-2">Your AI workforce starts here.</p>
          </div>

          <div className="flex justify-center gap-2">
            {[0, 1].map((s) => (
              <div key={s} className={`w-2 h-2 rounded-full ${s <= step ? "bg-accent" : "bg-surface-tertiary"}`} />
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-4">
              <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">Board type</label>
              <div className="flex gap-2">
                {(["dev", "ops"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setBoardType(t)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      boardType === t ? "bg-accent text-white" : "bg-surface-tertiary text-content-secondary hover:text-content-primary"
                    }`}
                  >
                    {t === "dev" ? "Dev" : "Ops"}
                    <span className="block text-xs font-normal mt-0.5 opacity-70">{t === "dev" ? "Git / PR workflow" : "No repo required"}</span>
                  </button>
                ))}
              </div>
              <label className="block text-xs font-medium text-content-tertiary uppercase tracking-wide">Board name</label>
              <Input value={boardName} onChange={(e) => setBoardName(e.target.value)} />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <Button onClick={handleCreateBoard} disabled={createBoard.isPending || !boardName.trim()} className="w-full">
                {createBoard.isPending ? "Creating..." : "Create Board"}
              </Button>
            </div>
          )}

          {step === 1 && apiKeyDisplay && apiKeyId && <AddMachineSteps apiKey={apiKeyDisplay} apiKeyId={apiKeyId} onDone={handleDone} />}
        </div>
      </div>
    </div>
  );
}
