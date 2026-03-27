import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { type User } from "./types";

export function RoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-accent-soft text-accent">
        admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-surface-tertiary text-content-tertiary">
      user
    </span>
  );
}

export function StatusBadge({ user }: { user: User }) {
  if (user.banned) {
    const badge = (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-error/10 text-error cursor-default">
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
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider bg-success/10 text-success">
      active
    </span>
  );
}
