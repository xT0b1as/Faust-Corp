import { afterEach, describe, expect, it, vi } from 'vitest';

import { Notifier } from '../src/projects/notifier.js';

describe('Notifier', () => {
  afterEach(() => vi.useRealTimers());

  it('bundles permission requests and finished leads into one message', async () => {
    vi.useFakeTimers();
    const posts: Array<{ url: string; body: string }> = [];
    const notifier = new Notifier({
      url: 'https://ntfy.example/topic',
      nameOf: (id) => ({ 1: 'Wagner: App', 2: 'Homunculus 1' })[id],
      isImportant: (id) => id === 1,
      post: async (url, body) => {
        posts.push({ url, body });
      },
      batchMs: 1000,
    });
    notifier.apply({ type: 'agentToolPermission', id: 2 });
    notifier.apply({ type: 'agentToolPermission', id: 2 });
    notifier.apply({ type: 'agentStatus', id: 2, status: 'waiting' });
    notifier.apply({ type: 'agentStatus', id: 1, status: 'waiting' });
    notifier.apply({ type: 'agentStatus', id: 1, status: 'active' });
    expect(posts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts).toEqual([
      {
        url: 'https://ntfy.example/topic',
        body: 'Homunculus 1 wartet auf deine Freigabe.\nWagner: App ist fertig.',
      },
    ]);
  });
});
