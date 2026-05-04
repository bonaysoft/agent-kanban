import { Button } from "./ui/button";

interface FilterBarProps {
  repositories: { id: string; name: string }[];
  labels: { name: string; color: string; description: string }[];
  activeRepository: string | null;
  activeLabel: string | null;
  onRepositoryChange: (repository: string | null) => void;
  onLabelChange: (label: string | null) => void;
}

export function FilterBar({ repositories, labels, activeRepository, activeLabel, onRepositoryChange, onLabelChange }: FilterBarProps) {
  if (repositories.length === 0 && labels.length === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-border">
      {repositories.length > 0 && (
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Button variant={activeRepository === null ? "secondary" : "outline"} size="xs" onClick={() => onRepositoryChange(null)}>
            All repos
          </Button>
          {repositories.map((r) => (
            <Button key={r.id} variant={activeRepository === r.id ? "secondary" : "outline"} size="xs" onClick={() => onRepositoryChange(r.id)}>
              {r.name}
            </Button>
          ))}
        </div>
      )}
      {labels.length > 0 && (
        <div className="ml-auto flex max-w-[50%] shrink-0 justify-end gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:max-w-full">
          <Button
            variant={activeLabel === null ? "secondary" : "outline"}
            size="xs"
            className="h-5 rounded-[4px] px-1.5 font-mono text-[10px] font-medium"
            onClick={() => onLabelChange(null)}
          >
            All labels
          </Button>
          {labels.map((label) => {
            const active = activeLabel === label.name;
            return (
              <Button
                key={label.name}
                variant="outline"
                size="xs"
                className="h-5 max-w-28 rounded-[4px] px-1.5 font-mono text-[10px] font-medium"
                onClick={() => onLabelChange(label.name)}
                title={label.description || label.name}
                style={{
                  color: label.color,
                  borderColor: `color-mix(in srgb, ${label.color} ${active ? 48 : 30}%, transparent)`,
                  backgroundColor: `color-mix(in srgb, ${label.color} ${active ? 14 : 6}%, transparent)`,
                }}
              >
                <span className="min-w-0 truncate">{label.name}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
