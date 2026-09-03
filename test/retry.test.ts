import { describe, expect, it } from 'vitest';
import { RETRYABLE_STATUSES, backoffMs, shouldRetry } from '../src/retry';

describe('retry policy', () => {
  it('only 429 and 503', () => {
    expect([...RETRYABLE_STATUSES].sort()).toEqual([429, 503]);
    for (const s of [200, 400, 401, 403, 404, 422, 500, 502]) expect(shouldRetry(s, 0, 5)).toBe(false);
  });
  it('budget', () => {
    expect(shouldRetry(429, 0, 2)).toBe(true);
    expect(shouldRetry(429, 1, 2)).toBe(true);
    expect(shouldRetry(429, 2, 2)).toBe(false);
    expect(shouldRetry(503, 0, 0)).toBe(false);
  });
  it('Retry-After wins, in ms', () => {
    expect(backoffMs(0, 7)).toBe(7000);
    expect(backoffMs(3, 1.5)).toBe(1500);
  });
  it('exponential with full jitter and cap', () => {
    expect(backoffMs(0, null, { rand: () => 1 })).toBe(500);
    expect(backoffMs(1, null, { rand: () => 1 })).toBe(1000);
    expect(backoffMs(2, null, { rand: () => 1 })).toBe(2000);
    expect(backoffMs(2, null, { rand: () => 0 })).toBe(0);
    expect(backoffMs(20, null, { rand: () => 1 })).toBe(30000);
  });
});
