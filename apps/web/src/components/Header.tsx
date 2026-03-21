import { Link, useLocation } from "react-router-dom";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { useState } from "react";

interface HeaderProps {
  boardName?: string;
}

const navLinks = [
  { to: "/machines", label: "Machines" },
  { to: "/agents", label: "Agents" },
  { to: "/settings", label: "Settings" },
];

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const themeIcons: Record<Theme, () => JSX.Element> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export function Header({ boardName }: HeaderProps) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const location = useLocation();

  function cycleTheme() {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const ThemeIcon = themeIcons[theme];

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
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                location.pathname === to
                  ? "text-accent bg-accent-soft"
                  : "text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
          className="text-content-tertiary hover:text-content-secondary p-1.5 rounded-md hover:bg-surface-tertiary transition-colors"
        >
          <ThemeIcon />
        </button>
      </div>
    </header>
  );
}
