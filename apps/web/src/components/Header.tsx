import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { useState, useRef, useEffect } from "react";
import { signOut, clearAuthToken, useSession } from "../lib/auth-client";
import { api } from "../lib/api";
import { useBoards } from "../hooks/useBoard";
import { BoardSwitcher } from "./BoardSwitcher";

const navLinks = [
  { to: "/agents", label: "Agents" },
  { to: "/machines", label: "Machines" },
];

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function UserAvatar({ name, image }: { name?: string; image?: string }) {
  if (image) {
    return <img src={image} alt="" className="w-7 h-7 rounded-full object-cover" />;
  }
  const initial = (name || "?")[0].toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-accent-soft text-accent text-xs font-bold flex items-center justify-center">
      {initial}
    </div>
  );
}

export function Header() {
  const { data: session } = useSession();
  const user = session?.user as { name?: string; email?: string; image?: string } | undefined;
  const { boards, refresh: refreshBoards } = useBoards();
  const { boardId } = useParams<{ boardId: string }>();

  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const activeBoard = boards.find((b: any) => b.id === boardId);

  function cycleTheme() {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
  }, [dropdownOpen]);

  function handleBoardSelect(id: string) {
    // If currently on a board route, navigate to the new board
    // Otherwise navigate to the board page
    navigate(`/boards/${id}`);
  }

  async function handleBoardCreate(name: string) {
    const created = await api.boards.create({ name });
    refreshBoards();
    if (created?.id) navigate(`/boards/${created.id}`);
  }

  async function handleSignOut() {
    await signOut();
    clearAuthToken();
    navigate("/auth");
  }

  return (
    <>
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-secondary">
        {/* Left: Logo + Board name */}
        <div className="flex items-center gap-2">
          <Link to="/" className="text-[15px] font-bold tracking-tight text-content-primary">
            Agent <span className="text-accent">Kanban</span>
          </Link>
          {activeBoard && (
            <>
              <span className="text-content-tertiary text-xs">/</span>
              <button
                onClick={() => setSwitcherOpen(true)}
                className="text-sm font-medium text-content-primary hover:text-accent transition-colors"
              >
                {activeBoard.name}
              </button>
            </>
          )}
        </div>
        {/* Right: Nav + Theme + Avatar */}
        <div className="flex items-center gap-1">
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${location.pathname.startsWith(to)
                    ? "text-accent bg-accent-soft"
                    : "text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary"
                  }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Avatar + Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="p-0.5 rounded-full hover:ring-2 hover:ring-accent/30 transition-all"
            >
              <UserAvatar name={user?.name} image={user?.image} />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-surface-secondary border border-border rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.3)] py-1 z-50">
                {/* User info */}
                {user && (
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium text-content-primary truncate">{user.name || user.email}</p>
                    {user.name && user.email && (
                      <p className="text-xs text-content-tertiary truncate">{user.email}</p>
                    )}
                  </div>
                )}

                <Link
                  to="/settings"
                  onClick={() => setDropdownOpen(false)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors ${location.pathname === "/settings"
                      ? "text-accent bg-accent-soft"
                      : "text-content-secondary hover:text-content-primary hover:bg-surface-tertiary"
                    }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </Link>

                <Link
                  to="/repositories"
                  onClick={() => setDropdownOpen(false)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors ${location.pathname === "/repositories"
                      ? "text-accent bg-accent-soft"
                      : "text-content-secondary hover:text-content-primary hover:bg-surface-tertiary"
                    }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  Repositories
                </Link>

                <div className="border-t border-border my-1" />

                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            title={`Theme: ${theme}`}
            className="text-content-tertiary hover:text-content-secondary p-1.5 rounded-md hover:bg-surface-tertiary transition-colors"
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>

      {switcherOpen && (
        <BoardSwitcher
          boards={boards}
          activeBoardId={boardId ?? null}
          onSelect={handleBoardSelect}
          onCreate={handleBoardCreate}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </>
  );
}
