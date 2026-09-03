/** Typed errors for the Redpine SDK. One class per HTTP status we document. */

export interface ErrorOpts { code?: string | null; requestId?: string | null; body?: unknown }

export class RedpineError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly body: unknown;

  constructor(status: number, message: string, opts: ErrorOpts = {}) {
    const parts = [`HTTP ${status}`];
    if (opts.code) parts.push(opts.code);
    parts.push(message);
    if (opts.requestId) parts.push(`(request ${opts.requestId})`);
    super(parts.join(' '));
    this.name = new.target.name;
    this.status = status;
    this.code = opts.code ?? null;
    this.requestId = opts.requestId ?? null;
    this.body = opts.body ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401: missing or invalid API key. */
export class AuthError extends RedpineError {}
/** 403: key has no access to the requested collection. */
export class AccessDenied extends RedpineError {}
/** 404: collection or queryId not found. */
export class NotFound extends RedpineError {}
/** 422: request rejected (query too long, bad filter, ...). */
export class ValidationError extends RedpineError {}
/** 429: rate or quota limit hit. `retryAfter` is seconds when the server said. */
export class QuotaExceeded extends RedpineError {
  readonly retryAfter: number | null;
  constructor(status: number, message: string, opts: ErrorOpts & { retryAfter?: number | null } = {}) {
    super(status, message, opts);
    this.retryAfter = opts.retryAfter ?? null;
  }
}
/** 503: assisted search temporarily unavailable. */
export class AssistedUnavailable extends RedpineError {}

const BY_STATUS: Record<number, new (status: number, message: string, opts?: ErrorOpts) => RedpineError> = {
  401: AuthError, 403: AccessDenied, 404: NotFound, 422: ValidationError, 503: AssistedUnavailable,
};

function readRetryAfter(headers?: Headers | Record<string, string>): number | null {
  if (!headers) return null;
  let v: string | null | undefined;
  if (typeof (headers as Headers).get === 'function') v = (headers as Headers).get('retry-after');
  else for (const [k, val] of Object.entries(headers)) if (k.toLowerCase() === 'retry-after') v = val;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function errorFromResponse(status: number, body: unknown, headers?: Headers | Record<string, string>): RedpineError {
  let parsed: Record<string, unknown> | null = null;
  if (typeof body === 'string') {
    try { const c = JSON.parse(body); if (c && typeof c === 'object') parsed = c; } catch { parsed = null; }
  } else if (body && typeof body === 'object') {
    parsed = body as Record<string, unknown>;
  }
  const inner = (parsed?.error && typeof parsed.error === 'object' ? parsed.error : {}) as Record<string, unknown>;
  const code = typeof inner.code === 'string' ? inner.code : null;
  const message = typeof inner.message === 'string' ? inner.message : `request failed with status ${status}`;
  const requestId = typeof inner.requestId === 'string' ? inner.requestId : null;
  if (status === 429) {
    return new QuotaExceeded(status, message, { code, requestId, body: parsed, retryAfter: readRetryAfter(headers) });
  }
  const Cls = BY_STATUS[status] ?? RedpineError;
  return new Cls(status, message, { code, requestId, body: parsed });
}
