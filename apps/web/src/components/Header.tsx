import { Link } from "react-router-dom";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { useState } from "react";

interface HeaderProps {
  boardName?: string;
}

export function Header({ boardName }: HeaderProps) {
  const [theme, setThemeState] = useState<Theme>(getTheme());

  function cycleTheme() {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-secondary">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-[15px] font-bold tracking-tight text-content-primary">
          Agent <span className="text-accent">Kanban</span>
        </Link>
        {boardName && (
          <span className="text-xs text-content-tertiary bg-surface-tertiary px-2 py-1 rounded-md">
            {boardName}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Link
          to="/machines"
          className="hidden md:inline text-content-tertiary hover:text-content-secondary text-xs px-2 py-1"
        >
          Machines
        </Link>
        <Link
          to="/agents"
          className="hidden md:inline text-content-tertiary hover:text-content-secondary text-xs px-2 py-1"
        >
          Agents
        </Link>
        <button
          onClick={cycleTheme}
          className="text-xs text-content-tertiary hover:text-content-secondary px-2 py-1 rounded border border-border hover:border-content-tertiary transition-colors"
        >
          {themeLabel}
        </button>
        <Link
          to="/settings"
          className="text-content-tertiary hover:text-content-secondary text-xs px-2 py-1"
        >
          Settings
        </Link>
      </div>
    </header>
  );
}
