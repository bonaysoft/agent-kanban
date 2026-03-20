export const DEFAULT_COLUMNS = ["Todo", "In Progress", "Done"] as const;

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const TASK_ACTIONS = [
  "created",
  "claimed",
  "moved",
  "commented",
  "completed",
] as const;

export const DEFAULT_BOARD_NAME = "My Board";
