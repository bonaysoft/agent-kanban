import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatRelative } from "../../components/TaskDetailFields";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { authClient, useSession } from "../../lib/auth-client";
import { BanUserDialog } from "./BanUserDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { SessionsPanel } from "./SessionsPanel";
import { SetRoleDialog } from "./SetRoleDialog";
import { type DialogKind, type User } from "./types";
import { RoleBadge, StatusBadge } from "./UserBadges";
import { SkeletonRows, UserRowActions } from "./UserTableRows";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type RoleFilter = "all" | "admin" | "user";
type StatusFilter = "all" | "active" | "banned";
type SortDirection = "asc" | "desc";

export function AdminUsersPage() {
  const { data: session } = useSession();
  const currentUserId = (session?.user as any)?.id;

  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);

  const [activeDialog, setActiveDialog] = useState<{ kind: DialogKind; user: User } | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<string | null>(null);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const query: Record<string, unknown> = {
      limit: pageSize,
      offset: page * pageSize,
      sortBy: "createdAt",
      sortDirection,
    };
    if (search) {
      query.searchField = "email";
      query.searchValue = search;
    }
    if (roleFilter !== "all") {
      query.filterField = "role";
      query.filterValue = roleFilter;
      query.filterOperator = "eq";
    } else if (statusFilter !== "all") {
      query.filterField = "banned";
      query.filterValue = statusFilter === "banned";
      query.filterOperator = "eq";
    }

    const { data, error } = await (authClient.admin as any).listUsers({ query });
    if (error || !data) {
      toast.error("Failed to load users");
      setLoading(false);
      return;
    }
    setUsers(data.users ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [page, pageSize, roleFilter, search, sortDirection, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setPage(0);
      setSearch(value.trim());
    }, 300);
  }

  function applyRoleFilter(value: RoleFilter | null) {
    if (!value) return;
    setPage(0);
    setRoleFilter(value);
    if (value !== "all") setStatusFilter("all");
  }

  function applyStatusFilter(value: StatusFilter | null) {
    if (!value) return;
    setPage(0);
    setStatusFilter(value);
    if (value !== "all") setRoleFilter("all");
  }

  function applySortDirection(value: SortDirection | null) {
    if (!value) return;
    setPage(0);
    setSortDirection(value);
  }

  function applyPageSize(value: string | null) {
    if (!value) return;
    setPage(0);
    setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number]);
  }

  async function handleUnban(user: User) {
    const { error } = await (authClient.admin as any).unbanUser({ userId: user.id });
    if (error) {
      toast.error("Failed to unban user");
    } else {
      toast.success("User unbanned");
      fetchUsers();
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
    fetchUsers();
  }

  function showSessionToast(type: "success" | "error", message: string) {
    if (type === "success") toast.success(message);
    else toast.error(message);
  }

  const offset = page * pageSize;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-content-primary tracking-tight">Users</h1>
        <span className="text-xs font-mono text-content-tertiary">{total} total</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search by email…" value={searchInput} onChange={(e) => handleSearchChange(e.target.value)} className="max-w-xs" />
        <Select value={roleFilter} onValueChange={applyRoleFilter}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={applyStatusFilter}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={sortDirection} onValueChange={applySortDirection}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="desc">Newest registered</SelectItem>
              <SelectItem value="asc">Oldest registered</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
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
            Showing {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Select value={String(pageSize)} onValueChange={applyPageSize}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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
