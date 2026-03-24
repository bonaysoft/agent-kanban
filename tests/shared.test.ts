import { describe, it, expect } from 'vitest';
import { TASK_ACTIONS, AGENT_STATUSES, STALE_TIMEOUT_MS, PRIORITIES } from '@agent-kanban/shared';

describe('shared constants', () => {
  it('TASK_ACTIONS includes all v2 actions', () => {
    expect(TASK_ACTIONS).toContain('assigned');
    expect(TASK_ACTIONS).toContain('released');
    expect(TASK_ACTIONS).toContain('timed_out');
  });

  it('AGENT_STATUSES has online, offline', () => {
    expect(AGENT_STATUSES).toEqual(['online', 'offline']);
  });

  it('STALE_TIMEOUT_MS is 2 hours', () => {
    expect(STALE_TIMEOUT_MS).toBe(7200000);
  });

  it('PRIORITIES has 4 levels', () => {
    expect(PRIORITIES).toHaveLength(4);
    expect(PRIORITIES).toContain('urgent');
  });
});
