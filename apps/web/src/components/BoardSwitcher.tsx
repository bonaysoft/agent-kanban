import { useState, useRef, useEffect } from "react";

interface Board {
  id: string;
  name: string;
  description?: string | null;
}

interface BoardSwitcherProps {
  boards: Board[];
  activeBoardId: string | null;
  onSelect: (boardId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export function BoardSwitcher({ boards, activeBoardId, onSelect, onCreate, onClose }: BoardSwitcherProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
    setCreating(false);
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50 backdrop-blur-[2px]" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
        <div className="bg-surface-secondary border border-border rounded-xl w-full max-w-md pointer-events-auto shadow-[0_25px_60px_rgba(0,0,0,0.5)]">

          {/* Search-style header */}
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <span className="text-[11px] font-mono font-medium text-content-tertiary uppercase tracking-[0.08em]">
              Switch Board
            </span>
          </div>

          {/* Board list */}
          <div className="max-h-[320px] overflow-y-auto py-1.5 px-1.5">
            {boards.map((b) => {
              const isActive = b.id === activeBoardId;
              return (
                <button
                  key={b.id}
                  onClick={() => { onSelect(b.id); onClose(); }}
                  className={`w-full text-left px-3.5 py-3 rounded-lg transition-colors group ${
                    isActive
                      ? "bg-accent-soft"
                      : "hover:bg-surface-tertiary"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Active indicator */}
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isActive ? "bg-accent" : "bg-transparent"
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium truncate ${
                        isActive ? "text-accent" : "text-content-primary"
                      }`}>
                        {b.name}
                      </div>
                      {b.description && (
                        <div className="text-xs text-content-tertiary truncate mt-0.5">
                          {b.description}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {boards.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-content-tertiary">No boards yet</p>
              </div>
            )}
          </div>

          {/* Footer: create */}
          <div className="border-t border-border px-4 py-3">
            {creating ? (
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreating(false); setNewName(""); }
                  }}
                  placeholder="Board name"
                  autoFocus
                  className="flex-1 bg-surface-primary border border-border rounded-md px-3 py-1.5 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="text-sm font-medium text-accent px-3 py-1.5 rounded-md hover:bg-accent-soft disabled:opacity-30 transition-colors"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 text-sm text-content-tertiary hover:text-content-secondary transition-colors w-full py-1"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New board
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
