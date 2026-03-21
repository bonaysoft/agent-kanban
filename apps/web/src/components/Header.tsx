import { Link, useLocation, useNavigate } from "react-router-dom";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { useState } from "react";
import { signOut, clearAuthToken } from "../lib/auth-client";
import { BoardSwitcher } from "./BoardSwitcher";

interface HeaderProps {
  boardName?: string;
  boards?: { id: string; name: string; description?: string | null }[];
  activeBoardId?: string | null;
  onBoardChange?: (boardId: string) => void;
  onBoardCreate?: (name: string) => void;
}

const navLinks = [
  { to: "/machines", label: "Machines" },
  { to: "/repos", label: "Repos" },
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

const themeIcons: Record<Theme, () => React.ReactElement> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function Header({ boardName, boards, activeBoardId, onBoardChange, onBoardCreate }: HeaderProps) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  function cycleTheme() {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const ThemeIcon = themeIcons[theme];

  return (
    <>
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-secondary">
        <div className="flex items-center gap-2">
          <Link to="/" className="text-[15px] font-bold tracking-tight text-content-primary">
            Agent <span className="text-accent">Kanban</span>
          </Link>
          {boards && boardName && (
            <>
              <span className="text-content-tertiary text-xs">/</span>
              <button
                onClick={() => setSwitcherOpen(true)}
                className="text-sm font-medium text-content-primary hover:text-accent transition-colors"
              >
                {boardName}
              </button>
            </>
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
          <button
            onClick={async () => {
              await signOut();
              clearAuthToken();
              navigate("/auth");
            }}
            title="Sign out"
            className="text-content-tertiary hover:text-content-secondary p-1.5 rounded-md hover:bg-surface-tertiary transition-colors"
          >
            <LogOutIcon />
          </button>
        </div>
      </header>

      {switcherOpen && boards && (
        <BoardSwitcher
          boards={boards}
          activeBoardId={activeBoardId ?? null}
          onSelect={(id) => onBoardChange?.(id)}
          onCreate={(name) => onBoardCreate?.(name)}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </>
  );
}
