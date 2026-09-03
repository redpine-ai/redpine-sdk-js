import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessDenied, AuthError, F, QuotaExceeded, Redpine } from '../src/index';
import { DEFAULT_BASE_URL, resolveApiKey, resolveBaseUrl } from '../src/client';

const KEY = 'sk_test_fake_abc123';
const SEARCH_OK = { results: [{ id: 'd1', text: 'hello', metadata: null, collection: null }], queryId: 'q-1', latencyMs: 12 };
const IMG = { imageMaxHeight: 600, imageMaxWidth: 800, imageQuality: 75 };

type Call = { url: string; method: string; headers: Headers; body: unknown };

function fakeFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = await req.text();
    calls.push({ url: req.url, method: req.method, headers: req.headers, body: text ? JSON.parse(text) : null });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status, headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  });
  return { fetchImpl, calls };
}

beforeEach(() => { for (const v of ['REDPINE_API_KEY', 'CONNECT_API_KEY', 'REDPINE_BASE_URL']) delete process.env[v]; });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('configuration', () => {
  it('explicit key wins, env fallback order', () => {
    process.env.CONNECT_API_KEY = 'sk_test_fake_connect';
    expect(resolveApiKey(undefined)).toBe('sk_test_fake_connect');
    process.env.REDPINE_API_KEY = 'sk_test_fake_redpine';
    expect(resolveApiKey(undefined)).toBe('sk_test_fake_redpine');
    expect(resolveApiKey('sk_test_fake_arg')).toBe('sk_test_fake_arg');
  });
  it('missing key throws AuthError', () => {
    expect(() => new Redpine()).toThrow(AuthError);
  });
  it('base url default and env', () => {
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe('https://api.redpine.ai');
    process.env.REDPINE_BASE_URL = 'http://127.0.0.1:8000/';
    expect(resolveBaseUrl()).toBe('http://127.0.0.1:8000');
  });
  it('base url set but empty throws', () => {
    process.env.REDPINE_BASE_URL = '';
    expect(() => resolveBaseUrl()).toThrow(/REDPINE_BASE_URL/);
    process.env.REDPINE_BASE_URL = '///';
    expect(() => resolveBaseUrl()).toThrow(/REDPINE_BASE_URL/);
  });
});

describe('requests', () => {
  it('search sends bearer and body with builder filters', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: SEARCH_OK }]);
    const c = new Redpine({ apiKey: KEY, fetch: fetchImpl });
    const r = await c.search('crispr', { collections: ['corpus'], limit: 5, filters: F('issn').eq('1664-302X').or(F('issn').eq('1932-6203')) });
    expect(r.queryId).toBe('q-1');
    expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}/api/v1/search/query`);
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({
      query: 'crispr', collections: ['corpus'], limit: 5,
      filters: { or: [{ field: 'issn', eq: '1664-302X' }, { field: 'issn', eq: '1932-6203' }] },
      includeMetadata: true, includeFigures: false, ...IMG,
    });
  });

  it('searchCollection uses path and omits collection keys', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: SEARCH_OK }]);
    await new Redpine({ apiKey: KEY, fetch: fetchImpl }).searchCollection('corpus', 'q');
    expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}/api/v1/search/corpus`);
    expect(calls[0].body).toEqual({ query: 'q', limit: 10, includeMetadata: true, includeFigures: false, ...IMG });
  });

  it('assistedSearch, getResults, quota, collections', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { status: 'results', queryUnderstanding: {}, results: [], clarification: null, billing: {}, queryId: 'q-2', latencyMs: 1, iterationsRun: 1 } },
      { status: 200, body: SEARCH_OK },
      { status: 200, body: { dailyLimit: 10, dailyUsed: 1, dailyRemaining: 9, monthlyLimit: 100, monthlyUsed: 1, monthlyRemaining: 99 } },
      { status: 200, body: { collections: [{ name: 'corpus', documentCount: 3 }], count: 1 } },
    ]);
    const c = new Redpine({ apiKey: KEY, fetch: fetchImpl });
    expect((await c.assistedSearch('why', { collection: 'corpus', allowClarification: false })).queryId).toBe('q-2');
    expect(calls[0].body).toMatchObject({ allowClarification: false, collection: 'corpus', includeFigures: false, ...IMG });
    expect((await c.getResults('q-1')).queryId).toBe('q-1');
    expect(calls[1].url).toBe(`${DEFAULT_BASE_URL}/api/v1/search/results/q-1`);
    expect((await c.quota()).dailyRemaining).toBe(9);
    expect((await c.collections()).count).toBe(1);
  });

  it('uses REDPINE_BASE_URL', async () => {
    process.env.REDPINE_BASE_URL = 'http://local.test';
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { dailyLimit: 1, dailyUsed: 0, dailyRemaining: 1, monthlyLimit: 1, monthlyUsed: 0, monthlyRemaining: 1 } }]);
    await new Redpine({ apiKey: KEY, fetch: fetchImpl }).quota();
    expect(calls[0].url).toBe('http://local.test/api/v1/search/quota');
  });

  it('search requires exactly one target', async () => {
    const c = new Redpine({ apiKey: KEY, fetch: fakeFetch([]).fetchImpl });
    await expect(c.search('q')).rejects.toThrow(/exactly one/);
    await expect(c.search('q', { collection: 'a', collections: ['b'] })).rejects.toThrow(/exactly one/);
    await expect(c.search('q', { collections: [] })).rejects.toThrow(/exactly one/);
  });

  it('empty collections + collection is valid and omits collections from the wire', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: SEARCH_OK }]);
    const c = new Redpine({ apiKey: KEY, fetch: fetchImpl });
    await c.search('q', { collection: 'a', collections: [] });
    expect(calls[0].body).toMatchObject({ collection: 'a' });
    expect(calls[0].body).not.toHaveProperty('collections');
  });
});

describe('errors and retries', () => {
  const err = (status: number, code: string, headers?: Record<string, string>) =>
    ({ status, body: { error: { code, message: 'm', requestId: 'r' } }, headers });

  it('403 -> AccessDenied', async () => {
    const { fetchImpl } = fakeFetch([err(403, 'FORBIDDEN')]);
    await expect(new Redpine({ apiKey: KEY, fetch: fetchImpl }).search('q', { collection: 'c' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('429 retries then succeeds, honouring Retry-After', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch([err(429, 'RATE_LIMITED', { 'Retry-After': '2' }), { status: 200, body: SEARCH_OK }]);
    const p = new Redpine({ apiKey: KEY, fetch: fetchImpl, maxRetries: 2 }).search('q', { collection: 'c' });
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).queryId).toBe('q-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('429 exhausts then throws QuotaExceeded', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch([err(429, 'R'), err(429, 'R'), err(429, 'R')]);
    const p = new Redpine({ apiKey: KEY, fetch: fetchImpl, maxRetries: 2 }).search('q', { collection: 'c' });
    const assertion = expect(p).rejects.toBeInstanceOf(QuotaExceeded);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('401 does not retry', async () => {
    const { fetchImpl } = fakeFetch([err(401, 'UNAUTHORIZED')]);
    await expect(new Redpine({ apiKey: KEY, fetch: fetchImpl, maxRetries: 3 }).search('q', { collection: 'c' })).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
