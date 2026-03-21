export const DEFAULT_COLUMNS = ["Todo", "In Progress", "In Review", "Done", "Cancelled"] as const;

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const TASK_ACTIONS = [
  "created",
  "claimed",
  "moved",
  "commented",
  "completed",
  "assigned",
  "released",
  "timed_out",
  "cancelled",
  "review_requested",
] as const;

export const AGENT_STATUSES = ["idle", "working", "offline"] as const;

export const STALE_TIMEOUT_MS = 7200000; // 2 hours

export const MACHINE_STALE_TIMEOUT_MS = 120000; // 2 minutes

export const MACHINE_STATUSES = ["online", "offline"] as const;

export const DEFAULT_BOARD_NAME = "My Board";

export const RESOURCE_TYPES = ["git_repo"] as const;

export const MESSAGE_ROLES = ["human", "agent"] as const;
