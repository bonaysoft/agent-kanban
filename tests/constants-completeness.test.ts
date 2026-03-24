import { describe, it, expect } from 'vitest';
import { TASK_ACTIONS, AGENT_STATUSES } from '@agent-kanban/shared';

describe('enum completeness', () => {
  it('TASK_ACTIONS matches the migration CHECK constraint', () => {
    const migrationActions = [
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
    ];
    expect([...TASK_ACTIONS]).toEqual(migrationActions);
  });

  it('AGENT_STATUSES covers all valid states', () => {
    expect([...AGENT_STATUSES]).toEqual(['online', 'offline']);
  });

  it('TaskAction type union matches TASK_ACTIONS constant', () => {
    const actions: string[] = [...TASK_ACTIONS];
    expect(actions).toHaveLength(11);
    expect(actions).toContain('assigned');
    expect(actions).toContain('released');
    expect(actions).toContain('timed_out');
    expect(actions).toContain('cancelled');
    expect(actions).toContain('rejected');
    expect(actions).toContain('review_requested');
  });
});
