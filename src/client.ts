/**
 * Hand-written client over the generated core.
 * The base URL is not an option: https://api.redpine.ai unless env REDPINE_BASE_URL says otherwise.
 */
import { createClient, type Client } from './generated/client';
import {
  getCachedResult, getQuota, listCollections, searchAssisted, searchCollection, searchPreview, searchQuery, searchUnlock,
} from './generated/sdk.gen';
import type {
  AssistedSearchResponse, CollectionsResponse, PreviewUnlockResponse, QuotaInfo, SearchResponse,
  SearchResultsPreviewResponse,
} from './generated/types.gen';
import { AuthError, QuotaExceeded, errorFromResponse } from './errors';
import { toFilterDict, type Filter } from './filters';
import { backoffMs, shouldRetry } from './retry';

export const DEFAULT_BASE_URL = 'https://api.redpine.ai';
export const ENV_API_KEY = 'REDPINE_API_KEY';
export const ENV_API_KEY_FALLBACK = 'CONNECT_API_KEY';
export const ENV_BASE_URL = 'REDPINE_BASE_URL';

// Image defaults the search endpoints require on every wire request (not user-configurable yet).
const IMAGE_DEFAULTS = { imageMaxHeight: 600, imageMaxWidth: 800, imageQuality: 75 } as const;

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' && process.env ? process.env[k] : undefined;

export function resolveApiKey(explicit: string | undefined): string {
  const key = explicit || env(ENV_API_KEY) || env(ENV_API_KEY_FALLBACK);
  if (!key) {
    throw new AuthError(401, `no API key: pass { apiKey } or set ${ENV_API_KEY} (Redpine dashboard > Settings > API Keys)`);
  }
  return key;
}

export function resolveBaseUrl(): string {
  const v = env(ENV_BASE_URL);
  if (v === undefined) return DEFAULT_BASE_URL;
  const trimmed = v.replace(/\/+$/, '');
  if (trimmed === '') {
    throw new Error(`${ENV_BASE_URL} is set but empty`);
  }
  return trimmed;
}

export interface RedpineOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Custom fetch (tests, non-standard runtimes). */
  fetch?: typeof fetch;
}

export interface SearchOptions {
  collection?: string;
  collections?: string[];
  limit?: number;
  filters?: Filter | Record<string, unknown> | null;
  includeMetadata?: boolean;
  includeFigures?: boolean;
}

export interface AssistedSearchOptions {
  collection?: string;
  collections?: string[];
  limit?: number;
  filters?: Filter | Record<string, unknown> | null;
  allowClarification?: boolean;
  includeMetadata?: boolean;
}

export interface PreviewOptions {
  collection?: string;
  collections?: string[];
  limit?: number;
  filters?: Filter | Record<string, unknown> | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function oneTarget(collection?: string, collections?: string[]): void {
  const hasCollections = collections != null && collections.length > 0;
  if ((collection == null) === !hasCollections) {
    throw new Error('pass exactly one of collection or collections');
  }
}

function withFilters<T extends object>(body: T, filters: SearchOptions['filters']): T & { filters?: Record<string, unknown> } {
  const f = toFilterDict(filters);
  return f === undefined ? body : { ...body, filters: f };
}

type Result<T> = { data?: T; error?: unknown; response: Response };

export class Redpine {
  private readonly client: Client;
  private readonly maxRetries: number;

  constructor(opts: RedpineOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 2;
    this.client = createClient({
      baseUrl: resolveBaseUrl(),
      headers: { Authorization: `Bearer ${resolveApiKey(opts.apiKey)}` },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    if (opts.timeoutMs != null) {
      const t = opts.timeoutMs;
      this.client.interceptors.request.use((req) => new Request(req, { signal: AbortSignal.timeout(t) }));
    }
  }

  private async call<T>(fn: () => Promise<Result<T>>): Promise<T> {
    let attempt = 0;
    for (;;) {
      const { data, error, response } = await fn();
      if (response.ok) return data as T;
      const err = errorFromResponse(response.status, error ?? null, response.headers);
      if (shouldRetry(response.status, attempt, this.maxRetries)) {
        await sleep(backoffMs(attempt, err instanceof QuotaExceeded ? err.retryAfter : null));
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    oneTarget(opts.collection, opts.collections);
    const body = withFilters({
      query,
      ...(opts.collection != null ? { collection: opts.collection } : {}),
      ...(opts.collections?.length ? { collections: [...opts.collections] } : {}),
      limit: opts.limit ?? 10,
      includeMetadata: opts.includeMetadata ?? true,
      includeFigures: opts.includeFigures ?? false,
      ...IMAGE_DEFAULTS,
    }, opts.filters);
    return this.call(() => searchQuery({ client: this.client, body }) as Promise<Result<SearchResponse>>);
  }

  async searchCollection(collection: string, query: string, opts: Omit<SearchOptions, 'collection' | 'collections'> = {}): Promise<SearchResponse> {
    const body = withFilters({
      query,
      limit: opts.limit ?? 10,
      includeMetadata: opts.includeMetadata ?? true,
      includeFigures: opts.includeFigures ?? false,
      ...IMAGE_DEFAULTS,
    }, opts.filters);
    return this.call(() => searchCollection({ client: this.client, path: { collection }, body }) as Promise<Result<SearchResponse>>);
  }

  async assistedSearch(query: string, opts: AssistedSearchOptions = {}): Promise<AssistedSearchResponse> {
    oneTarget(opts.collection, opts.collections);
    const body = withFilters({
      query,
      ...(opts.collection != null ? { collection: opts.collection } : {}),
      ...(opts.collections?.length ? { collections: [...opts.collections] } : {}),
      limit: opts.limit ?? 10,
      allowClarification: opts.allowClarification ?? true,
      includeMetadata: opts.includeMetadata ?? true,
      includeFigures: false,
      ...IMAGE_DEFAULTS,
    }, opts.filters);
    return this.call(() => searchAssisted({ client: this.client, body }) as Promise<Result<AssistedSearchResponse>>);
  }

  /** Free: teaser rows plus the cost to unlock each. Never charged, never a quota slot. */
  async preview(query: string, opts: PreviewOptions = {}): Promise<PreviewUnlockResponse> {
    oneTarget(opts.collection, opts.collections);
    const body = withFilters({
      query,
      ...(opts.collection != null ? { collection: opts.collection } : {}),
      ...(opts.collections?.length ? { collections: [...opts.collections] } : {}),
      limit: opts.limit ?? 10,
    }, opts.filters);
    return this.call(() => searchPreview({ client: this.client, body }) as Promise<Result<PreviewUnlockResponse>>);
  }

  /** Pay for previewed rows. Omit `resultIds` to unlock every row; re-sending paid ids is free. */
  unlock(queryId: string, resultIds?: string[]): Promise<PreviewUnlockResponse> {
    const body = { queryId, ...(resultIds ? { resultIds: [...resultIds] } : {}) };
    return this.call(() => searchUnlock({ client: this.client, body }) as Promise<Result<PreviewUnlockResponse>>);
  }

  getResults(queryId: string): Promise<SearchResultsPreviewResponse> {
    return this.call(() => getCachedResult({ client: this.client, path: { queryId } }) as Promise<Result<SearchResultsPreviewResponse>>);
  }

  quota(): Promise<QuotaInfo> {
    return this.call(() => getQuota({ client: this.client }) as Promise<Result<QuotaInfo>>);
  }

  collections(): Promise<CollectionsResponse> {
    return this.call(() => listCollections({ client: this.client }) as Promise<Result<CollectionsResponse>>);
  }
}
