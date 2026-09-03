/** Retry policy: 429 and 503 only, exponential backoff with full jitter, Retry-After wins. */

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/** `attempt` is zero-based: retries already made. */
export function shouldRetry(status: number, attempt: number, maxRetries: number): boolean {
  return RETRYABLE_STATUSES.has(status) && attempt < maxRetries;
}

export function backoffMs(
  attempt: number,
  retryAfterSec: number | null,
  opts: { base?: number; factor?: number; cap?: number; rand?: () => number } = {},
): number {
  if (retryAfterSec != null) return retryAfterSec * 1000;
  const { base = 500, factor = 2, cap = 30000, rand = Math.random } = opts;
  return Math.min(cap, base * factor ** attempt) * rand();
}
