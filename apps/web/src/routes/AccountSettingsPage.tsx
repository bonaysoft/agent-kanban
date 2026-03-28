import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { useBoards, useDeleteBoard, useUpdateBoard } from "../hooks/useBoard";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { getTheme, setTheme, type Theme } from "../lib/theme";

function BoardItem({ board }: { board: any }) {
  const [expanded, setExpanded] = useState(false);
  const [editName, setEditName] = useState(board.name);
  const [editDesc, setEditDesc] = useState(board.description || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const updateBoard = useUpdateBoard();
  const deleteBoard = useDeleteBoard();

  useEffect(() => {
    setEditName(board.name);
    setEditDesc(board.description || "");
  }, [board.name, board.description]);

  const nameChanged = editName.trim() !== board.name;
  const descChanged = editDesc.trim() !== (board.description || "");
  const hasChanges = nameChanged || descChanged;

  async function handleSave() {
    if (!editName.trim()) return;
    await updateBoard.mutateAsync({ id: board.id, name: editName.trim(), description: editDesc.trim() });
  }

  async function handleDelete() {
    await deleteBoard.mutateAsync(board.id);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-tertiary/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
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
        <span className="text-sm font-medium text-content-primary flex-1 truncate">{board.name}</span>
        <button
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
                  <button onClick={handleDelete} className="text-xs font-medium text-error hover:underline">
                    Yes
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-content-tertiary hover:text-content-secondary">
                    No
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-xs text-error hover:underline">
                  Delete
                </button>
              )}
            </div>
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={updateBoard.isPending || !editName.trim()}
                className="bg-accent text-[#09090B] font-medium text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {updateBoard.isPending ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GitHubSection() {
  const [accounts, setAccounts] = useState<Array<{ providerId: string }>>([]);
  const [syncing, setSyncing] = useState<"gpg" | "emails" | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    authClient.listAccounts().then((res: any) => {
      if (res.data) setAccounts(res.data);
    });
  }, []);

  const isConnected = accounts.some((a) => a.providerId === "github");

  async function handleConnect() {
    await authClient.signIn.social({ provider: "github", callbackURL: "/settings" });
  }

  async function handleSyncGpg() {
    setSyncing("gpg");
    setSyncMsg(null);
    try {
      await api.github.syncGpg();
      setSyncMsg("GPG key synced to GitHub.");
    } catch (err: any) {
      setSyncMsg(`Error: ${err.message}`);
    } finally {
      setSyncing(null);
    }
  }

  async function handleSyncEmails() {
    setSyncing("emails");
    setSyncMsg(null);
    try {
      await api.github.syncEmails();
      setSyncMsg("Agent emails synced to GitHub.");
    } catch (err: any) {
      setSyncMsg(`Error: ${err.message}`);
    } finally {
      setSyncing(null);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">GitHub</h2>
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-content-primary font-medium">GitHub Account</p>
            <p className="text-xs text-content-tertiary mt-0.5">
              {isConnected ? "Connected — GPG keys and agent emails can be synced." : "Not connected"}
            </p>
          </div>
          {!isConnected && (
            <button onClick={handleConnect} className="bg-accent text-[#09090B] font-medium text-xs px-3 py-1.5 rounded-md hover:opacity-90">
              Connect GitHub
            </button>
          )}
          {isConnected && <span className="text-xs text-green-500 font-medium">Connected</span>}
        </div>

        {isConnected && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSyncGpg}
              disabled={syncing !== null}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-content-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              {syncing === "gpg" ? "Syncing…" : "Sync GPG Key"}
            </button>
            <button
              onClick={handleSyncEmails}
              disabled={syncing !== null}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-content-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
            >
              {syncing === "emails" ? "Syncing…" : "Sync Emails"}
            </button>
          </div>
        )}

        {syncMsg && <p className={`text-xs ${syncMsg.startsWith("Error") ? "text-error" : "text-content-secondary"}`}>{syncMsg}</p>}
      </div>
    </section>
  );
}

export function AccountSettingsPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());
  const { boards } = useBoards();

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

        {/* GitHub */}
        <GitHubSection />

        {/* Boards */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Boards</h2>
          {boards.length === 0 ? (
            <p className="text-sm text-content-tertiary">No boards yet.</p>
          ) : (
            <div className="space-y-2">
              {boards.map((board: any) => (
                <BoardItem key={board.id} board={board} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
