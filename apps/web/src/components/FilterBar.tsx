interface FilterBarProps {
  projects: string[];
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
          key={p}
          onClick={() => onProjectChange(p)}
          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
            activeProject === p
              ? "border-accent text-accent bg-accent-soft"
              : "border-border text-content-secondary bg-surface-secondary"
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
