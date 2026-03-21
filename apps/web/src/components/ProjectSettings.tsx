import { useState, useEffect } from "react";
import { api } from "../lib/api";

export function ProjectSettings() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Record<string, any[]>>({});
  const [newRepo, setNewRepo] = useState({ name: "", url: "" });

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    const data = await api.projects.list();
    setProjects(data);
    setLoading(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    await api.projects.create({ name: newName.trim(), description: newDesc.trim() || undefined });
    setNewName("");
    setNewDesc("");
    await loadProjects();
  }

  async function handleDelete(id: string) {
    await api.projects.delete(id);
    setProjects(projects.filter((p) => p.id !== id));
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!repositories[id]) {
      const res = await api.projects.repositories.list(id);
      setRepositories((prev) => ({ ...prev, [id]: res }));
    }
  }

  async function handleAddRepo(projectId: string) {
    if (!newRepo.name.trim() || !newRepo.url.trim()) return;
    await api.projects.repositories.add(projectId, {
      name: newRepo.name.trim(),
      url: newRepo.url.trim(),
    });
    setNewRepo({ name: "", url: "" });
    const res = await api.projects.repositories.list(projectId);
    setRepositories((prev) => ({ ...prev, [projectId]: res }));
  }

  async function handleDeleteRepo(projectId: string, repoId: string) {
    await api.projects.repositories.delete(projectId, repoId);
    setRepositories((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] || []).filter((r) => r.id !== repoId),
    }));
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Projects</h2>

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name"
          className="flex-1 bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
        />
        <input
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Description (optional)"
          className="flex-1 bg-surface-primary border border-border rounded-lg px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
        />
        <button
          onClick={handleCreate}
          className="bg-accent text-[#09090B] font-medium text-sm px-4 py-2 rounded-lg hover:opacity-90"
        >
          Create
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 bg-surface-secondary border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <div key={project.id} className="bg-surface-secondary border border-border rounded-lg">
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => toggleExpand(project.id)}
                  className="flex-1 text-left"
                >
                  <span className="text-sm text-content-primary font-medium">{project.name}</span>
                  {project.description && (
                    <span className="text-xs text-content-tertiary ml-2">{project.description}</span>
                  )}
                  <span className="text-xs text-content-tertiary ml-2">({project.id})</span>
                </button>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="text-xs text-error hover:underline ml-2"
                >
                  Delete
                </button>
              </div>

              {expandedId === project.id && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  <h3 className="text-xs font-semibold text-content-tertiary uppercase">Repositories</h3>

                  {(repositories[project.id] || []).map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="text-content-primary">{r.name}</span>
                        <span className="text-xs text-content-tertiary ml-2 font-mono">{r.url}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteRepo(project.id, r.id)}
                        className="text-xs text-error hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <input
                      value={newRepo.name}
                      onChange={(e) => setNewRepo((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Repo name"
                      className="flex-1 bg-surface-primary border border-border rounded-lg px-3 py-1.5 text-xs text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
                    />
                    <input
                      value={newRepo.url}
                      onChange={(e) => setNewRepo((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="Clone URL"
                      className="flex-1 bg-surface-primary border border-border rounded-lg px-3 py-1.5 text-xs text-content-primary placeholder:text-content-tertiary outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => handleAddRepo(project.id)}
                      className="text-xs text-accent hover:underline px-2"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-content-tertiary">No projects.</p>
          )}
        </div>
      )}
    </section>
  );
}
