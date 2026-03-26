import { useState } from "react";
import { Header } from "../components/Header";
import { formatRelative } from "../components/TaskDetailFields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { useCreateRepository, useDeleteRepository, useRepositories } from "../hooks/useRepositories";

export function RepositoriesPage() {
  const { repos, loading } = useRepositories();
  const createRepo = useCreateRepository();
  const deleteRepo = useDeleteRepository();
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  async function handleAdd() {
    if (!newName.trim() || !newUrl.trim()) return;
    await createRepo.mutateAsync({ name: newName.trim(), url: newUrl.trim() });
    setNewName("");
    setNewUrl("");
    setShowDialog(false);
  }

  async function handleDelete(id: string) {
    await deleteRepo.mutateAsync(id);
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-content-primary">Repositories</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-content-tertiary font-mono">{repos.length} total</span>
            <button
              onClick={() => setShowDialog(true)}
              className="bg-accent text-[#09090B] font-medium text-xs px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity"
            >
              Add Repository
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 bg-surface-secondary border border-border rounded-lg animate-pulse" />
            ))}
          </div>
        ) : repos.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-content-secondary text-sm">No repositories registered.</p>
            <p className="text-content-tertiary text-xs">
              Repositories are added when you run <code className="font-mono text-accent">ak link</code> in a project directory.
            </p>
            <pre className="inline-block bg-surface-secondary border border-border rounded-lg px-4 py-2 text-xs font-mono text-content-secondary mt-2">
              npx agent-kanban link
            </pre>
            <p className="text-content-tertiary text-xs mt-3">
              Or{" "}
              <button onClick={() => setShowDialog(true)} className="text-accent hover:underline">
                add manually
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {repos.map((repo) => (
              <div key={repo.id} className="bg-surface-secondary border border-border rounded-lg px-5 py-4 hover:border-accent/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-content-primary font-medium truncate">{repo.name}</span>
                    <span className="text-[11px] font-mono text-content-tertiary truncate hidden sm:inline">{repo.url}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(repo.id)}
                    disabled={deleteRepo.isPending}
                    className="text-xs text-content-tertiary hover:text-error transition-colors shrink-0 ml-3 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-6 text-xs text-content-secondary">
                  <div>
                    <span className="text-content-tertiary">Tasks: </span>
                    <span className="font-mono text-content-primary">{repo.task_count ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-content-tertiary">Added: </span>
                    <span className="font-mono text-content-primary">{formatRelative(repo.created_at)}</span>
                  </div>
                  <span className="text-[11px] font-mono text-content-tertiary truncate sm:hidden">{repo.url}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          if (!open) setShowDialog(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Repository</DialogTitle>
            <DialogDescription className="sr-only">Add a new repository to track tasks</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-content-tertiary uppercase tracking-wide font-medium">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-repo"
                className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-content-tertiary uppercase tracking-wide font-medium">Clone URL</label>
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent font-mono"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newUrl.trim() || createRepo.isPending}
              className="w-full bg-accent text-[#09090B] font-medium text-sm py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {createRepo.isPending ? "Adding..." : "Add Repository"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
