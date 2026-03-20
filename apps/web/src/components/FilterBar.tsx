interface FilterBarProps {
  projects: { id: string; name: string }[];
  activeProject: string | null;
  onProjectChange: (project: string | null) => void;
}

export function FilterBar({ projects, activeProject, onProjectChange }: FilterBarProps) {
  if (projects.length === 0) return null;

  return (
    <div className="flex gap-2 px-5 py-2.5 border-b border-border">
      <button
        onClick={() => onProjectChange(null)}
        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
          activeProject === null
            ? "border-accent text-accent bg-accent-soft"
            : "border-border text-content-secondary bg-surface-secondary"
        }`}
      >
        All projects
      </button>
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => onProjectChange(p.id)}
          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
            activeProject === p.id
              ? "border-accent text-accent bg-accent-soft"
              : "border-border text-content-secondary bg-surface-secondary"
          }`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
