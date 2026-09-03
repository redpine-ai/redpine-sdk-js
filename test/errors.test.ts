import { describe, expect, it } from 'vitest';
import {
  AccessDenied, AssistedUnavailable, AuthError, Expired, InsufficientCredits, NotFound, QuotaExceeded,
  RedpineError, ValidationError, errorFromResponse,
} from '../src/errors';

const body = (code = 'X', message = 'msg', requestId = 'req-1') => ({ error: { code, message, requestId } });

describe('errorFromResponse', () => {
  it.each([
    [401, AuthError], [402, InsufficientCredits], [403, AccessDenied], [404, NotFound], [410, Expired],
    [422, ValidationError], [429, QuotaExceeded], [503, AssistedUnavailable], [500, RedpineError], [418, RedpineError],
  ])('maps %i', (status, cls) => {
    const e = errorFromResponse(status, body());
    expect(e).toBeInstanceOf(cls);
    expect(e).toBeInstanceOf(RedpineError);
    expect(e.status).toBe(status);
    expect(e.code).toBe('X');
    expect(e.requestId).toBe('req-1');
  });

  it('non-json body still builds error', () => {
    const e = errorFromResponse(502, '<html>');
    expect(e.constructor).toBe(RedpineError);
    expect(e.code).toBeNull();
    expect(e.message).toContain('502');
  });

  it('QuotaExceeded reads Retry-After from Headers and plain object', () => {
    expect((errorFromResponse(429, body(), new Headers({ 'Retry-After': '7' })) as QuotaExceeded).retryAfter).toBe(7);
    expect((errorFromResponse(429, body(), { 'retry-after': '3' }) as QuotaExceeded).retryAfter).toBe(3);
    expect((errorFromResponse(429, body()) as QuotaExceeded).retryAfter).toBeNull();
  });

  it('message includes status, code, message, requestId', () => {
    const s = errorFromResponse(403, body('FORBIDDEN', 'no access', 'abc')).message;
    for (const part of ['403', 'FORBIDDEN', 'no access', 'abc']) expect(s).toContain(part);
  });
});
