import { useState, useEffect } from "react";
import { api } from "../lib/api";

export function ProjectSettings() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

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
                <div>
                  <span className="text-sm text-content-primary font-medium">{project.name}</span>
                  {project.description && (
                    <span className="text-xs text-content-tertiary ml-2">{project.description}</span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="text-xs text-error hover:underline ml-2"
                >
                  Delete
                </button>
              </div>
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
