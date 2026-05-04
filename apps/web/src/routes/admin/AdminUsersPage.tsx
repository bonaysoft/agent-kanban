import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatRelative } from "../../components/TaskDetailFields";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { authClient, useSession } from "../../lib/auth-client";
import { BanUserDialog } from "./BanUserDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { SessionsPanel } from "./SessionsPanel";
import { SetRoleDialog } from "./SetRoleDialog";
import { type DialogKind, type User } from "./types";
import { RoleBadge, StatusBadge } from "./UserBadges";
import { SkeletonRows, UserRowActions } from "./UserTableRows";

const PAGE_SIZE = 20;

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

  async function handleUnban(user: User) {
    const { error } = await (authClient.admin as any).unbanUser({ userId: user.id });
    if (error) {
      toast.error("Failed to unban user");
    } else {
      toast.success("User unbanned");
      fetchUsers(page * PAGE_SIZE, search);
    }
  }

  function handleAction(kind: DialogKind, user: User) {
    if (kind === "ban" && user.banned) {
      handleUnban(user);
      return;
    }
    setActiveDialog({ kind, user });
  }

  function onDialogSuccess() {
    const messages: Record<DialogKind, string> = {
      role: "Role updated",
      ban: "User banned",
      delete: "User deleted",
    };
    if (activeDialog) toast.success(messages[activeDialog.kind]);
    fetchUsers(page * PAGE_SIZE, search);
  }

  function showSessionToast(type: "success" | "error", message: string) {
    if (type === "success") toast.success(message);
    else toast.error(message);
  }

  const offset = page * PAGE_SIZE;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-content-primary tracking-tight">Users</h1>
        <span className="text-xs font-mono text-content-tertiary">{total} total</span>
      </div>

      <div className="mb-4">
        <Input placeholder="Search by email…" onChange={(e) => handleSearchChange(e.target.value)} className="max-w-xs" />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-secondary">
              <th className="px-4 py-3 text-left text-xs font-medium text-content-tertiary uppercase tracking-wider">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-content-tertiary uppercase tracking-wider">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-content-tertiary uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-content-tertiary uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-content-tertiary text-sm">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <Fragment key={user.id}>
                  <tr className="border-b border-border bg-surface-secondary hover:bg-surface-tertiary transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback className="bg-surface-tertiary text-content-secondary text-xs">
                            {(user.name || user.email)[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-content-primary text-sm font-medium leading-tight">{user.name || "—"}</p>
                          <p className="font-mono text-xs text-content-tertiary leading-tight">{user.email}</p>
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
                      <span className="font-mono text-xs text-content-tertiary">{formatRelative(user.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <UserRowActions
                        user={user}
                        isSelf={user.id === currentUserId}
                        onAction={handleAction}
                        onViewSessions={(uid) => setExpandedSessions((prev) => (prev === uid ? null : uid))}
                      />
                    </td>
                  </tr>
                  {expandedSessions === user.id && (
                    <tr className="bg-surface-primary border-b border-border">
                      <td colSpan={5}>
                        <div className="pt-2">
                          <p className="px-4 pb-1 text-xs font-medium text-content-tertiary uppercase tracking-wider">Sessions</p>
                          <SessionsPanel userId={user.id} onToast={showSessionToast} />
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

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs text-content-tertiary">
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

      {activeDialog?.kind === "role" && (
        <SetRoleDialog user={activeDialog.user} open onClose={() => setActiveDialog(null)} onSuccess={onDialogSuccess} />
      )}
      {activeDialog?.kind === "ban" && (
        <BanUserDialog user={activeDialog.user} open onClose={() => setActiveDialog(null)} onSuccess={onDialogSuccess} />
      )}
      {activeDialog?.kind === "delete" && (
        <DeleteUserDialog user={activeDialog.user} open onClose={() => setActiveDialog(null)} onSuccess={onDialogSuccess} />
      )}
    </div>
  );
}
