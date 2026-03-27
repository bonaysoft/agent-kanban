import { useEffect, useState } from "react";
import { Skeleton } from "../../components/ui/skeleton";
import { api } from "../../lib/api";

interface TasksByStatus {
  todo: number;
  in_progress: number;
  in_review: number;
  done: number;
  cancelled: number;
}

interface AdminStats {
  users: { total: number; new_this_week: number };
  agents: { total: number; online: number };
  tasks: { total: number; by_status: TasksByStatus };
  boards: { total: number };
}

const STATUS_COLORS: Record<string, string> = {
  todo: "#71717A",
  in_progress: "#22D3EE",
  in_review: "#EAB308",
  done: "#22C55E",
  cancelled: "#3F3F46",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

function StatCard({ label, value, subtitle }: { label: string; value: number; subtitle: string }) {
  return (
    <div className="bg-zinc-900 dark:bg-zinc-900 rounded-lg p-6 border border-zinc-800">
      <p className="text-sm text-zinc-500 mb-1">{label}</p>
      <p className="text-[32px] font-semibold text-zinc-100 leading-none" style={{ fontFamily: "Geist Mono, monospace" }}>
        {value}
      </p>
      <p className="text-xs text-zinc-400 mt-2">{subtitle}</p>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 space-y-3">
      <Skeleton className="h-4 w-20 bg-zinc-800" />
      <Skeleton className="h-9 w-16 bg-zinc-800" />
      <Skeleton className="h-3 w-28 bg-zinc-800" />
    </div>
  );
}

type StatusKey = keyof TasksByStatus;

function TaskStatusBar({ byStatus }: { byStatus: TasksByStatus }) {
  const statuses: StatusKey[] = ["todo", "in_progress", "in_review", "done", "cancelled"];
  const total = statuses.reduce((sum, s) => sum + (byStatus[s] || 0), 0);

  if (total === 0) return null;

  return (
    <div className="mt-8">
      <p className="text-sm font-medium text-zinc-400 mb-3">Task Status Breakdown</p>
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {statuses.map((status) => {
          const count = byStatus[status] || 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div key={status} style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[status] }} title={`${STATUS_LABELS[status]}: ${count}`} />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 mt-3">
        {statuses.map((status) => {
          const count = byStatus[status] || 0;
          return (
            <div key={status} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS[status] }} />
              <span className="text-xs text-zinc-500">{STATUS_LABELS[status]}</span>
              <span className="text-xs font-mono text-zinc-400">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.admin
      .getStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const tasksByStatus: TasksByStatus = stats?.tasks.by_status ?? { todo: 0, in_progress: 0, in_review: 0, done: 0, cancelled: 0 };
  const activeTaskCount = (tasksByStatus.in_progress || 0) + (tasksByStatus.in_review || 0);

  return (
    <div className="px-8 py-10 max-w-5xl">
      <h1 className="text-2xl font-semibold text-zinc-100 mb-8" style={{ letterSpacing: "-0.02em" }}>
        Dashboard
      </h1>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Users" value={stats.users.total} subtitle={`${stats.users.new_this_week} new this week`} />
            <StatCard label="Agents" value={stats.agents.total} subtitle={`${stats.agents.online} online`} />
            <StatCard label="Tasks" value={stats.tasks.total} subtitle={`${activeTaskCount} active`} />
            <StatCard label="Boards" value={stats.boards.total} subtitle="" />
          </div>
          <TaskStatusBar byStatus={tasksByStatus} />
        </>
      ) : (
        <p className="text-zinc-500 text-sm">Failed to load stats.</p>
      )}
    </div>
  );
}
