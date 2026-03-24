export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export const TASK_ACTIONS = [
  'created',
  'claimed',
  'moved',
  'commented',
  'completed',
  'assigned',
  'released',
  'timed_out',
  'cancelled',
  'rejected',
  'review_requested',
] as const;

export const AGENT_STATUSES = ['online', 'offline'] as const;

export const MACHINE_STATUSES = ['online', 'offline'] as const;

export const STALE_TIMEOUT_MS = 7200000; // 2 hours (task stale)

export const MACHINE_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

export const MACHINE_STALE_TIMEOUT_MS = 60000; // 60 seconds (miss 2 heartbeats)

export const SENDER_TYPES = ['user', 'agent'] as const;
