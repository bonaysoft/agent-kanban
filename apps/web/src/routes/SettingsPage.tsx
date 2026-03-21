import { useState, useEffect } from "react";
import { Header } from "../components/Header";
import { ProjectSettings } from "../components/ProjectSettings";
import { api } from "../lib/api";
import { getTheme, setTheme, type Theme } from "../lib/theme";

export function SettingsPage() {
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

  useEffect(() => {
    api.machines.list().then(setMachines).finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const result = await api.machines.create(newKeyName || undefined);
    setCreatedKey(result.key);
    setNewKeyName("");
    const updated = await api.machines.list();
    setMachines(updated);
  }

  async function handleDelete(id: string) {
    await api.machines.delete(id);
    setMachines(machines.filter((m) => m.id !== id));
  }

  function handleTheme(theme: Theme) {
    setTheme(theme);
    setCurrentTheme(theme);
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        <h1 className="text-xl font-bold text-content-primary">Settings</h1>

        {/* Theme */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Theme</h2>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTheme(t)}
                className={`text-sm px-4 py-2 rounded-lg border transition-colors capitalize ${
                  currentTheme === t
                    ? "border-accent text-accent bg-accent-soft"
                    : "border-border text-content-secondary hover:border-content-tertiary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Projects */}
        <ProjectSettings />

        {/* Machines (API Keys) */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Machines</h2>

          {createdKey && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-sm">
              <p className="text-success font-medium mb-1">Machine created! Copy the key now — it won't be shown again.</p>
              <code className="font-mono text-xs text-content-primary break-all">{createdKey}</code>
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Machine name (e.g. my-macbook)"
              className="flex-1 bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
            />
            <button
              onClick={handleCreate}
              className="bg-accent text-[#09090B] font-medium text-sm px-4 py-2 rounded-lg hover:opacity-90"
            >
              Create
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-12 bg-surface-secondary border border-border rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {machines.map((machine) => (
                <div key={machine.id} className="flex items-center justify-between bg-surface-secondary border border-border rounded-lg px-4 py-3">
                  <div>
                    <span className="text-sm text-content-primary">{machine.name || "Unnamed"}</span>
                    <span className="text-xs text-content-tertiary ml-2">({machine.id})</span>
                  </div>
                  <button
                    onClick={() => handleDelete(machine.id)}
                    className="text-xs text-error hover:underline"
                  >
                    Delete
                  </button>
                </div>
              ))}
              {machines.length === 0 && (
                <p className="text-sm text-content-tertiary">No machines registered.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
