import { useState } from "react";
import { Header } from "../components/Header";
import { ProjectSettings } from "../components/ProjectSettings";
import { getTheme, setTheme, type Theme } from "../lib/theme";

export function SettingsPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

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
      </div>
    </div>
  );
}
