import { BoardShareSettings } from "./BoardShareSettings";
import { Button } from "./ui/button";

interface FilterBarProps {
  repositories: { id: string; name: string }[];
  activeRepository: string | null;
  onRepositoryChange: (repository: string | null) => void;
  board?: { id: string; name: string; visibility: "private" | "public"; share_slug: string | null } | null;
}

export function FilterBar({ repositories, activeRepository, onRepositoryChange, board }: FilterBarProps) {
  const hasRepositories = repositories.length > 0;

  if (!hasRepositories && !board) return null;

  return (
    <div className="flex items-center justify-between gap-2 px-5 py-2.5 border-b border-border">
      <div className="flex gap-2">
        {hasRepositories && (
          <>
            <Button variant={activeRepository === null ? "secondary" : "outline"} size="xs" onClick={() => onRepositoryChange(null)}>
              All repos
            </Button>
            {repositories.map((r) => (
              <Button key={r.id} variant={activeRepository === r.id ? "secondary" : "outline"} size="xs" onClick={() => onRepositoryChange(r.id)}>
                {r.name}
              </Button>
            ))}
          </>
        )}
      </div>
      {board && <BoardShareSettings board={board} />}
    </div>
  );
}
