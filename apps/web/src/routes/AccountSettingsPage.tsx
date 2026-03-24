import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { useBoards } from "../hooks/useBoard";
import { api } from "../lib/api";
import { getTheme, setTheme, type Theme } from "../lib/theme";

function BoardItem({
  board,
  onUpdate,
  onDelete,
}: {
  board: any;
  onUpdate: () => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editName, setEditName] = useState(board.name);
  const [editDesc, setEditDesc] = useState(board.description || "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setEditName(board.name);
    setEditDesc(board.description || "");
  }, [board.id, board.name, board.description]);

  const nameChanged = editName.trim() !== board.name;
  const descChanged = editDesc.trim() !== (board.description || "");
  const hasChanges = nameChanged || descChanged;

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    await api.boards.update(board.id, {
      name: editName.trim(),
      description: editDesc.trim(),
    });
    setSaving(false);
    onUpdate();
  }

  async function handleDelete() {
    await api.boards.delete(board.id);
    onDelete(board.id);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* biome-ignore lint/a11y/useSemanticElements: container with nested interactive children cannot be a button */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-3 px-4 py-3 w-full cursor-pointer hover:bg-surface-tertiary/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-content-tertiary transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-sm font-medium text-content-primary flex-1 truncate">
          {board.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/boards/${board.id}`);
          }}
          className="text-xs text-content-tertiary hover:text-accent transition-colors"
        >
          Open
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          <div>
            <label
              htmlFor={`board-name-${board.id}`}
              className="block text-xs text-content-tertiary mb-1"
            >
              Name
            </label>
            <input
              id={`board-name-${board.id}`}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor={`board-desc-${board.id}`}
              className="block text-xs text-content-tertiary mb-1"
            >
              Description
            </label>
            <textarea
              id={`board-desc-${board.id}`}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={2}
              placeholder="What is this board for?"
              className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent resize-none"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-error">Delete?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="text-xs font-medium text-error hover:underline"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-content-tertiary hover:text-content-secondary"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-error hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
            {hasChanges && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !editName.trim()}
                className="bg-accent text-[#09090B] font-medium text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountSettingsPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());
  const { boards, refresh } = useBoards();

  function handleTheme(theme: Theme) {
    setTheme(theme);
    setCurrentTheme(theme);
  }

  function handleBoardDelete(_id: string) {
    refresh();
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        <h1 className="text-xl font-bold text-content-primary">Settings</h1>

        {/* Theme */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">
            Theme
          </h2>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button
                type="button"
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

        {/* Boards */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">
            Boards
          </h2>
          {boards.length === 0 ? (
            <p className="text-sm text-content-tertiary">No boards yet.</p>
          ) : (
            <div className="space-y-2">
              {boards.map((board: any) => (
                <BoardItem
                  key={board.id}
                  board={board}
                  onUpdate={refresh}
                  onDelete={handleBoardDelete}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
