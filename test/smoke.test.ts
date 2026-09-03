import { describe, expect, it } from 'vitest';
import { Redpine } from '../src/index';

describe.skipIf(process.env.SMOKE !== '1')('smoke', () => {
  it('quota, collections, search', async () => {
    const c = new Redpine();
    const q = await c.quota();
    expect(q.dailyLimit).toBeGreaterThanOrEqual(0);
    const cols = await c.collections();
    expect(cols.count).toBe(cols.collections.length);
    if (cols.count) {
      const r = await c.search('test', { collection: cols.collections[0].name, limit: 1 });
      expect(r.queryId).toBeTruthy();
    }
  });
});
