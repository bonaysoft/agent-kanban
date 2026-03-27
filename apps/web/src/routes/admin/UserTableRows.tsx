import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { type DialogKind, type User } from "./types";

export function UserRowActions({
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
          <button className="p-1.5 rounded hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary transition-colors">
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
            <DropdownMenuItem className="text-error focus:text-error" onClick={() => onAction("delete", user)}>
              Delete User
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-border">
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-7 h-7 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-40" />
              </div>
            </div>
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-14 rounded" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-14 rounded" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-3 w-16" />
          </td>
          <td className="px-4 py-3" />
        </tr>
      ))}
    </>
  );
}
