import { Button } from './ui/button';

interface FilterBarProps {
  repositories: { id: string; name: string }[];
  activeRepository: string | null;
  onRepositoryChange: (repository: string | null) => void;
}

export function FilterBar({ repositories, activeRepository, onRepositoryChange }: FilterBarProps) {
  if (repositories.length === 0) return null;

  return (
    <div className="flex gap-2 px-5 py-2.5 border-b border-border">
      <Button
        variant={activeRepository === null ? 'secondary' : 'outline'}
        size="xs"
        onClick={() => onRepositoryChange(null)}
      >
        All repos
      </Button>
      {repositories.map((r) => (
        <Button
          key={r.id}
          variant={activeRepository === r.id ? 'secondary' : 'outline'}
          size="xs"
          onClick={() => onRepositoryChange(r.id)}
        >
          {r.name}
        </Button>
      ))}
    </div>
  );
}
