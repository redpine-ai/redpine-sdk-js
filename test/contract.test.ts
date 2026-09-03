import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as sdk from '../src/index';
import { DEFAULT_BASE_URL } from '../src/client';

// monorepo: typescript/test -> ../../spec; public repo: test -> ../spec
const DIR = [resolve(__dirname, '../../spec/fixtures'), resolve(__dirname, '../spec/fixtures')].find(existsSync);
if (!DIR) throw new Error('spec/fixtures not found next to the package');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) throw new Error('spec/fixtures is empty');
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

beforeEach(() => { for (const v of ['REDPINE_API_KEY', 'CONNECT_API_KEY', 'REDPINE_BASE_URL']) delete process.env[v]; });

describe('contract fixtures', () => {
  for (const f of files) {
    it(f, async () => {
      const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      const calls: Array<{ url: string; method: string; body: unknown }> = [];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        const text = await req.text();
        calls.push({ url: req.url, method: req.method, body: text ? JSON.parse(text) : null });
        return new Response(JSON.stringify(fx.response.body), {
          status: fx.response.status, headers: { 'content-type': 'application/json', ...fx.response.headers },
        });
      });
      const client = new sdk.Redpine({ apiKey: 'sk_test_fake_contract', fetch: fetchImpl, maxRetries: 0 });
      const a = Object.fromEntries(Object.entries(fx.args as Record<string, unknown>).map(([k, v]) => [camel(k), v]));

      let call: Promise<unknown>;
      switch (fx.op) {
        case 'search': { const { query, ...rest } = a; call = client.search(query as string, rest); break; }
        case 'search_collection': { const { collection, query, ...rest } = a; call = client.searchCollection(collection as string, query as string, rest); break; }
        case 'assisted_search': { const { query, ...rest } = a; call = client.assistedSearch(query as string, rest); break; }
        case 'get_results': call = client.getResults(a.queryId as string); break;
        case 'quota': call = client.quota(); break;
        case 'collections': call = client.collections(); break;
        default: throw new Error(`unknown op ${fx.op}`);
      }

      if (fx.expect.error) {
        const Cls = (sdk as unknown as Record<string, new () => Error>)[fx.expect.error];
        const caught = await call.then(() => null, (e: unknown) => e);
        expect(caught).toBeInstanceOf(Cls);
        if (fx.expect.retry_after != null) expect((caught as sdk.QuotaExceeded).retryAfter).toBe(fx.expect.retry_after);
      } else {
        const result = (await call) as Record<string, unknown>;
        expect(result[fx.expect.field]).toEqual(fx.expect.value);
      }
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe(fx.request.method);
      expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}${fx.request.path}`);
      expect(calls[0].body).toEqual(fx.request.body);
    });
  }
});
