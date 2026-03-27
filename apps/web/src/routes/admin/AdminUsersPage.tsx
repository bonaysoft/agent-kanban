import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { formatRelative } from "../../components/TaskDetailFields";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { authClient, useSession } from "../../lib/auth-client";

const PAGE_SIZE = 20;

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  banned?: boolean;
  banReason?: string;
  banExpires?: string | null;
  createdAt: string;
  image?: string;
}

interface Session {
  id: string;
  token: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  expiresAt: string;
}

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

// --- Toast ---

let toastSeq = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return { toasts, push };
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg ${
            t.type === "success" ? "bg-[#22C55E] text-zinc-900" : "bg-[#EF4444] text-white"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// --- Badges ---

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-[rgba(34,211,238,0.1)] text-[#22D3EE]">
        admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-zinc-800 text-zinc-400">
      user
    </span>
  );
}

function StatusBadge({ user }: { user: User }) {
  if (user.banned) {
    const badge = (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-[rgba(239,68,68,0.1)] text-[#EF4444] cursor-default">
        banned
      </span>
    );
    if (user.banReason) {
      return (
        <Tooltip>
          <TooltipTrigger render={<span />}>{badge}</TooltipTrigger>
          <TooltipContent>{user.banReason}</TooltipContent>
        </Tooltip>
      );
    }
    return badge;
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-[rgba(34,197,94,0.1)] text-[#22C55E]">
      active
    </span>
  );
}

// --- Dialogs ---

function SetRoleDialog({ user, open, onClose, onSuccess }: { user: User; open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [role, setRole] = useState(user.role);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    const { error } = await (authClient.admin as any).setRole({ userId: user.id, role });
    setLoading(false);
    if (!error) {
      onSuccess();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Set Role</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-zinc-400">
          User: <span className="font-mono text-zinc-200">{user.email}</span>
        </p>
        <Select value={role} onValueChange={(v) => v && setRole(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter showCloseButton>
          <Button size="sm" disabled={loading || role === user.role} onClick={handleSubmit}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BAN_EXPIRY_OPTIONS = [
  { label: "1 hour", value: "3600" },
  { label: "24 hours", value: "86400" },
  { label: "7 days", value: "604800" },
  { label: "30 days", value: "2592000" },
  { label: "Permanent", value: "" },
];

function BanUserDialog({ user, open, onClose, onSuccess }: { user: User; open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    const params: Record<string, unknown> = { userId: user.id, banReason: reason || undefined };
    if (expiry) params.banExpiresIn = Number(expiry);
    const { error } = await (authClient.admin as any).banUser(params);
    setLoading(false);
    if (!error) {
      onSuccess();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Ban User</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-zinc-400">
          User: <span className="font-mono text-zinc-200">{user.email}</span>
        </p>
        <div className="space-y-3">
          <Textarea placeholder="Ban reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[72px]" />
          <Select value={expiry} onValueChange={(v) => setExpiry(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Duration" />
            </SelectTrigger>
            <SelectContent>
              {BAN_EXPIRY_OPTIONS.map((opt) => (
                <SelectItem key={opt.label} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter showCloseButton>
          <Button size="sm" variant="destructive" disabled={loading} onClick={handleSubmit}>
            {loading ? "Banning…" : "Ban User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ user, open, onClose, onSuccess }: { user: User; open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const { error } = await (authClient.admin as any).removeUser({ userId: user.id });
    setLoading(false);
    if (!error) {
      onSuccess();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-300">
          Delete <span className="font-mono text-zinc-100">{user.email}</span>?
        </p>
        <p className="text-xs text-zinc-500">This action cannot be undone.</p>
        <DialogFooter showCloseButton>
          <Button size="sm" variant="destructive" disabled={loading} onClick={handleDelete}>
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Sessions Panel ---

function SessionsPanel({ user, onToast }: { user: User; onToast: (type: Toast["type"], msg: string) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    (authClient.admin as any)
      .listUserSessions({ userId: user.id })
      .then(({ data, error }: any) => {
        if (!error && data) setSessions(data.sessions ?? data ?? []);
      })
      .finally(() => setLoading(false));
  }, [user.id]);

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
    const { error } = await (authClient.admin as any).revokeUserSessions({ userId: user.id });
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
          <Skeleton key={i} className="h-8 bg-zinc-800 rounded" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="px-4 pb-3 text-xs text-zinc-500">No active sessions.</p>;
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-500">
          {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
        </span>
        <button onClick={revokeAll} disabled={revoking === "all"} className="text-xs text-[#EF4444] hover:underline disabled:opacity-50">
          {revoking === "all" ? "Revoking…" : "Revoke All"}
        </button>
      </div>
      {sessions.map((s) => (
        <div key={s.id} className="flex items-start justify-between gap-4 bg-zinc-900 rounded p-2.5">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[11px] font-mono text-zinc-400 truncate">{s.token.slice(0, 16)}…</p>
            {s.ipAddress && <p className="text-[10px] text-zinc-500">{s.ipAddress}</p>}
            {s.userAgent && <p className="text-[10px] text-zinc-600 truncate max-w-xs">{s.userAgent}</p>}
            <p className="text-[10px] font-mono text-zinc-600">
              Created {formatRelative(s.createdAt)} · Expires {formatRelative(s.expiresAt)}
            </p>
          </div>
          <button
            onClick={() => revokeSession(s.token)}
            disabled={revoking === s.token}
            className="text-xs text-[#EF4444] hover:underline disabled:opacity-50 shrink-0 mt-0.5"
          >
            {revoking === s.token ? "…" : "Revoke"}
          </button>
        </div>
      ))}
    </div>
  );
}

// --- Row Actions Dropdown ---

type DialogKind = "role" | "ban" | "delete";

function UserRowActions({
  user,
  isSelf,
  onAction,
  onViewSessions,
}: {
  user: User;
  isSelf: boolean;
  onAction: (kind: DialogKind, user: User) => void;
  onViewSessions: (userId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onAction("role", user)}>Set Role</DropdownMenuItem>
        {user.banned ? (
          <DropdownMenuItem onClick={() => onAction("ban", user)}>Unban User</DropdownMenuItem>
        ) : (
          !isSelf && <DropdownMenuItem onClick={() => onAction("ban", user)}>Ban User</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onViewSessions(user.id)}>View Sessions</DropdownMenuItem>
        {!isSelf && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[#EF4444] focus:text-[#EF4444]" onClick={() => onAction("delete", user)}>
              Delete User
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Skeleton rows ---

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-zinc-800">
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-7 h-7 rounded-full bg-zinc-800" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-28 bg-zinc-800" />
                <Skeleton className="h-2.5 w-40 bg-zinc-800" />
              </div>
            </div>
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-14 bg-zinc-800 rounded" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-14 bg-zinc-800 rounded" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-3 w-16 bg-zinc-800" />
          </td>
          <td className="px-4 py-3" />
        </tr>
      ))}
    </>
  );
}

// --- Main Page ---

export function AdminUsersPage() {
  const { data: session } = useSession();
  const currentUserId = (session?.user as any)?.id;

  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [activeDialog, setActiveDialog] = useState<{ kind: DialogKind; user: User } | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<string | null>(null);

  const { toasts, push: pushToast } = useToasts();

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = useCallback(async (offset: number, searchValue: string) => {
    setLoading(true);
    const params: Record<string, unknown> = { query: { limit: PAGE_SIZE, offset } };
    if (searchValue) {
      params.query = { ...(params.query as object), searchField: "email", searchValue };
    }
    const { data, error } = await (authClient.admin as any).listUsers(params);
    setLoading(false);
    if (error || !data) return;
    setUsers(data.users ?? []);
    setTotal(data.total ?? 0);
  }, []);

  useEffect(() => {
    fetchUsers(page * PAGE_SIZE, search);
  }, [fetchUsers, page, search]);

  function handleSearchChange(value: string) {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setPage(0);
      setSearch(value);
    }, 300);
  }

  function openDialog(kind: DialogKind, user: User) {
    setActiveDialog({ kind, user });
  }

  function closeDialog() {
    setActiveDialog(null);
  }

  async function handleUnban(user: User) {
    const { error } = await (authClient.admin as any).unbanUser({ userId: user.id });
    if (error) {
      pushToast("error", "Failed to unban user");
    } else {
      pushToast("success", "User unbanned");
      fetchUsers(page * PAGE_SIZE, search);
    }
  }

  function handleAction(kind: DialogKind, user: User) {
    if (kind === "ban" && user.banned) {
      handleUnban(user);
      return;
    }
    openDialog(kind, user);
  }

  function handleViewSessions(userId: string) {
    setExpandedSessions((prev) => (prev === userId ? null : userId));
  }

  function onDialogSuccess() {
    const messages: Record<DialogKind, string> = {
      role: "Role updated",
      ban: "User banned",
      delete: "User deleted",
    };
    if (activeDialog) pushToast("success", messages[activeDialog.kind]);
    fetchUsers(page * PAGE_SIZE, search);
  }

  const offset = page * PAGE_SIZE;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100" style={{ letterSpacing: "-0.02em" }}>
          Users
        </h1>
        <span className="text-xs font-mono text-zinc-500">{total} total</span>
      </div>

      {/* Search */}
      <div className="mb-4">
        <Input placeholder="Search by email…" onChange={(e) => handleSearchChange(e.target.value)} className="max-w-xs" />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-zinc-500 text-sm">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <Fragment key={user.id}>
                  <tr className="border-b border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback className="bg-zinc-800 text-zinc-300 text-xs">{(user.name || user.email)[0].toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-zinc-100 text-sm font-medium leading-tight">{user.name || "—"}</p>
                          <p className="font-mono text-xs text-zinc-400 leading-tight">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge user={user} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-zinc-500">{formatRelative(user.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <UserRowActions user={user} isSelf={user.id === currentUserId} onAction={handleAction} onViewSessions={handleViewSessions} />
                    </td>
                  </tr>
                  {expandedSessions === user.id && (
                    <tr className="bg-zinc-950 border-b border-zinc-800">
                      <td colSpan={5}>
                        <div className="pt-2">
                          <p className="px-4 pb-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">Sessions</p>
                          <SessionsPanel user={user} onToast={pushToast} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <span>
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {activeDialog?.kind === "role" && <SetRoleDialog user={activeDialog.user} open onClose={closeDialog} onSuccess={onDialogSuccess} />}
      {activeDialog?.kind === "ban" && <BanUserDialog user={activeDialog.user} open onClose={closeDialog} onSuccess={onDialogSuccess} />}
      {activeDialog?.kind === "delete" && <DeleteUserDialog user={activeDialog.user} open onClose={closeDialog} onSuccess={onDialogSuccess} />}

      <ToastStack toasts={toasts} />
    </div>
  );
}
