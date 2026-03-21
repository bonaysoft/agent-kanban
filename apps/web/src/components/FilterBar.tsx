interface FilterBarProps {
  repositories: { id: string; name: string }[];
  activeRepository: string | null;
  onRepositoryChange: (repository: string | null) => void;
}

export function FilterBar({ repositories, activeRepository, onRepositoryChange }: FilterBarProps) {
  if (repositories.length === 0) return null;

  return (
    <div className="flex gap-2 px-5 py-2.5 border-b border-border">
      <button
        onClick={() => onRepositoryChange(null)}
        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
          activeRepository === null
            ? "border-accent text-accent bg-accent-soft"
            : "border-border text-content-secondary bg-surface-secondary"
        }`}
      >
        All repos
      </button>
      {repositories.map((r) => (
        <button
          key={r.id}
          onClick={() => onRepositoryChange(r.id)}
          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
            activeRepository === r.id
              ? "border-accent text-accent bg-accent-soft"
              : "border-border text-content-secondary bg-surface-secondary"
          }`}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}
