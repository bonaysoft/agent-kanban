import { agentIdenticon, agentColor } from "../lib/agentIdentity";

interface AgentIdenticonProps {
  publicKey: string | null | undefined;
  name?: string;
  size?: number;
}

export function AgentIdenticon({ publicKey, name, size = 40 }: AgentIdenticonProps) {
  if (!publicKey) {
    return (
      <div
        className="rounded-full bg-accent/20 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="font-mono text-accent font-bold" style={{ fontSize: size * 0.35 }}>
          {(name || "??").slice(0, 2).toUpperCase()}
        </span>
      </div>
    );
  }

  const grid = agentIdenticon(publicKey);
  const color = agentColor(publicKey);
  const cellSize = size / 6;
  const padding = cellSize / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} rx={size * 0.2} fill="var(--surface-tertiary, #27272A)" />
      {grid.map((row, y) =>
        row.map((filled, x) =>
          filled ? (
            <rect
              key={`${y}-${x}`}
              x={padding + x * cellSize}
              y={padding + y * cellSize}
              width={cellSize * 0.85}
              height={cellSize * 0.85}
              rx={cellSize * 0.15}
              fill={color}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
