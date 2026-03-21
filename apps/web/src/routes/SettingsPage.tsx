import { useState, useEffect } from "react";
import { Header } from "../components/Header";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { api } from "../lib/api";
import { useBoard } from "../hooks/useBoard";

export function SettingsPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());
  const { board, boards, activeBoardId, refresh, switchBoard } = useBoard();

  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (board) {
      setEditName(board.name);
      setEditDesc(board.description || "");
    }
  }, [board?.id]);

  function handleTheme(theme: Theme) {
    setTheme(theme);
    setCurrentTheme(theme);
  }

  async function handleSave() {
    if (!board || !editName.trim()) return;
    setSaving(true);
    await api.boards.update(board.id, {
      name: editName.trim(),
      description: editDesc.trim() || undefined,
    });
    setSaving(false);
    refresh();
  }

  async function handleDelete() {
    if (!board) return;
    await api.boards.delete(board.id);
    setConfirmDelete(false);
    refresh();
  }

  const nameChanged = board && editName.trim() !== board.name;
  const descChanged = board && editDesc.trim() !== (board.description || "");
  const hasChanges = nameChanged || descChanged;

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header
        boardName={board?.name}
        boards={boards}
        activeBoardId={activeBoardId}
        onBoardChange={switchBoard}
        onBoardCreate={async (name) => { await api.boards.create({ name }); refresh(); }}
      />
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

        {/* Board settings */}
        {board && (
          <section className="space-y-4">
            <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Board</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-content-tertiary mb-1">Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-xs text-content-tertiary mb-1">Description</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  placeholder="What is this board for?"
                  className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent resize-none"
                />
              </div>

              {hasChanges && (
                <button
                  onClick={handleSave}
                  disabled={saving || !editName.trim()}
                  className="bg-accent text-[#09090B] font-medium text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            {/* Delete */}
            <div className="pt-4 border-t border-border">
              {confirmDelete ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-error">Delete "{board.name}"? This cannot be undone.</span>
                  <button
                    onClick={handleDelete}
                    className="text-sm font-medium text-error border border-error rounded-lg px-3 py-1.5 hover:bg-error/10"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-sm text-content-tertiary hover:text-content-secondary"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-sm text-error hover:underline"
                >
                  Delete this board
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
