import { useEffect, useState } from "react";
import { formatRelative } from "../../components/TaskDetailFields";
import { Skeleton } from "../../components/ui/skeleton";
import { authClient } from "../../lib/auth-client";

interface Session {
  id: string;
  token: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  expiresAt: string;
}

type ToastType = "success" | "error";

interface Props {
  userId: string;
  onToast: (type: ToastType, msg: string) => void;
}

export function SessionsPanel({ userId, onToast }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    (authClient.admin as any)
      .listUserSessions({ userId })
      .then(({ data, error }: any) => {
        if (!error && data) setSessions(data.sessions ?? data ?? []);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  async function revokeSession(token: string) {
    setRevoking(token);
    const { error } = await (authClient.admin as any).revokeUserSession({ sessionToken: token });
    setRevoking(null);
    if (error) {
      onToast("error", "Failed to revoke session");
    } else {
      onToast("success", "Session revoked");
      setSessions((prev) => prev.filter((s) => s.token !== token));
    }
  }

  async function revokeAll() {
    setRevoking("all");
    const { error } = await (authClient.admin as any).revokeUserSessions({ userId });
    setRevoking(null);
    if (error) {
      onToast("error", "Failed to revoke sessions");
    } else {
      onToast("success", "All sessions revoked");
      setSessions([]);
    }
  }

  if (loading) {
    return (
      <div className="px-4 pb-3 space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-8 rounded" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="px-4 pb-3 text-xs text-content-tertiary">No active sessions.</p>;
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-content-tertiary">
          {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
        </span>
        <button onClick={revokeAll} disabled={revoking === "all"} className="text-xs text-error hover:underline disabled:opacity-50">
          {revoking === "all" ? "Revoking…" : "Revoke All"}
        </button>
      </div>
      {sessions.map((s) => (
        <div key={s.id} className="flex items-start justify-between gap-4 bg-surface-secondary rounded p-2.5">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[11px] font-mono text-content-secondary truncate">{s.token.slice(0, 16)}…</p>
            {s.ipAddress && <p className="text-[10px] text-content-tertiary">{s.ipAddress}</p>}
            {s.userAgent && <p className="text-[10px] text-content-tertiary truncate max-w-xs">{s.userAgent}</p>}
            <p className="text-[10px] font-mono text-content-tertiary">
              Created {formatRelative(s.createdAt)} · Expires {formatRelative(s.expiresAt)}
            </p>
          </div>
          <button
            onClick={() => revokeSession(s.token)}
            disabled={revoking === s.token}
            className="text-xs text-error hover:underline disabled:opacity-50 shrink-0 mt-0.5"
          >
            {revoking === s.token ? "…" : "Revoke"}
          </button>
        </div>
      ))}
    </div>
  );
}
