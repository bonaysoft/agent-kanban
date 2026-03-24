// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Miniflare } from 'miniflare';
import { createTestEnv, setupMiniflare, seedUser } from './helpers/db';

const env = createTestEnv();
let mf: Miniflare;

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
  await seedUser(env.DB, 'pos-test-user', 'pos@test.com');
});

afterAll(async () => {
  await mf.dispose();
});

describe('updateTask position field', () => {
  let boardId: string;

  beforeAll(async () => {
    const { createBoard } = await import('../apps/web/functions/api/boardRepo');
    const board = await createBoard(env.DB, 'pos-test-user', 'Position Test Board');
    boardId = board.id;
  });

  it('updateTask accepts position and persists the new value', async () => {
    const { createTask, updateTask } = await import('../apps/web/functions/api/taskRepo');
    const task = await createTask(env.DB, 'pos-test-user', {
      title: 'Position Task',
      board_id: boardId,
    });

    const updated = await updateTask(env.DB, task.id, { position: 99 });

    expect(updated).not.toBeNull();
    expect(updated!.position).toBe(99);
  });

  it('updateTask preserves other fields when only position is updated', async () => {
    const { createTask, updateTask } = await import('../apps/web/functions/api/taskRepo');
    const task = await createTask(env.DB, 'pos-test-user', {
      title: 'Position Preserve',
      board_id: boardId,
      priority: 'high',
    });

    const updated = await updateTask(env.DB, task.id, { position: 5 });

    expect(updated!.title).toBe('Position Preserve');
    expect(updated!.priority).toBe('high');
    expect(updated!.position).toBe(5);
  });

  it('updateTask with position zero persists zero', async () => {
    const { createTask, updateTask } = await import('../apps/web/functions/api/taskRepo');
    const task = await createTask(env.DB, 'pos-test-user', {
      title: 'Zero Position',
      board_id: boardId,
    });

    const updated = await updateTask(env.DB, task.id, { position: 0 });

    expect(updated!.position).toBe(0);
  });

  it('updateTask position does not affect status', async () => {
    const { createTask, updateTask } = await import('../apps/web/functions/api/taskRepo');
    const task = await createTask(env.DB, 'pos-test-user', {
      title: 'Status Stable',
      board_id: boardId,
    });

    const updated = await updateTask(env.DB, task.id, { position: 10 });

    expect(updated!.status).toBe('todo');
  });

  it('updateTask returns null for unknown task even with position', async () => {
    const { updateTask } = await import('../apps/web/functions/api/taskRepo');
    const updated = await updateTask(env.DB, 'nonexistent-id', { position: 5 });
    expect(updated).toBeNull();
  });

  it('updateTask can update position together with title', async () => {
    const { createTask, updateTask } = await import('../apps/web/functions/api/taskRepo');
    const task = await createTask(env.DB, 'pos-test-user', {
      title: 'Multi Update',
      board_id: boardId,
    });

    const updated = await updateTask(env.DB, task.id, { title: 'Renamed', position: 7 });

    expect(updated!.title).toBe('Renamed');
    expect(updated!.position).toBe(7);
  });

  it('updateTask persists position to DB and can be read back via getTask', async () => {
    const { createTask, updateTask, getTask } = await import('../apps/web/functions/api/taskRepo');
    const task = await createTask(env.DB, 'pos-test-user', {
      title: 'Persist Position',
      board_id: boardId,
    });

    await updateTask(env.DB, task.id, { position: 42 });
    const fetched = await getTask(env.DB, task.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.position).toBe(42);
  });
});
