import { describe, expect, it } from 'vitest';
import { F, toFilterDict } from '../src/filters';

describe('filter DSL', () => {
  it('leaf ops', () => {
    expect(F('issn').eq('a').toJSON()).toEqual({ field: 'issn', eq: 'a' });
    expect(F('f').ne('x').toJSON()).toEqual({ field: 'f', ne: 'x' });
    expect(F('f').in(['a', 'b']).toJSON()).toEqual({ field: 'f', in: ['a', 'b'] });
    expect(F('f').notIn(['a']).toJSON()).toEqual({ field: 'f', not_in: ['a'] });
    expect(F('f').gt(1).toJSON()).toEqual({ field: 'f', gt: 1 });
    expect(F('f').gte(5).toJSON()).toEqual({ field: 'f', gte: 5 });
    expect(F('f').lt(2).toJSON()).toEqual({ field: 'f', lt: 2 });
    expect(F('f').lte(3).toJSON()).toEqual({ field: 'f', lte: 3 });
    expect(F('y').between(2020, 2024).toJSON()).toEqual({ field: 'y', between: [2020, 2024] });
  });

  it('or / and / not', () => {
    expect(F('issn').eq('a').or(F('issn').eq('b')).toJSON()).toEqual({
      or: [{ field: 'issn', eq: 'a' }, { field: 'issn', eq: 'b' }],
    });
    expect(F('j').eq('N').and(F('y').gte(2020)).toJSON()).toEqual({
      and: [{ field: 'j', eq: 'N' }, { field: 'y', gte: 2020 }],
    });
    expect(F('doi').eq('x').not().toJSON()).toEqual({ not: [{ field: 'doi', eq: 'x' }] });
  });

  it('chained same combinator flattens; mixed nests', () => {
    expect(F('a').eq(1).and(F('b').eq(2)).and(F('c').eq(3)).toJSON()).toEqual({
      and: [{ field: 'a', eq: 1 }, { field: 'b', eq: 2 }, { field: 'c', eq: 3 }],
    });
    expect(F('a').eq(1).or(F('b').eq(2)).and(F('c').eq(3).not()).toJSON()).toEqual({
      and: [{ or: [{ field: 'a', eq: 1 }, { field: 'b', eq: 2 }] }, { not: [{ field: 'c', eq: 3 }] }],
    });
  });

  it('toFilterDict passthrough / undefined / reject', () => {
    const raw = { journal: 'Nature' };
    expect(toFilterDict(raw)).toBe(raw);
    expect(toFilterDict(null)).toBeUndefined();
    expect(toFilterDict(undefined)).toBeUndefined();
    expect(toFilterDict(F('x').eq(1))).toEqual({ field: 'x', eq: 1 });
    // @ts-expect-error wrong type
    expect(() => toFilterDict('issn=1')).toThrow(TypeError);
  });

  it('JSON.stringify uses toJSON', () => {
    expect(JSON.stringify({ filters: F('x').eq(1) })).toBe('{"filters":{"field":"x","eq":1}}');
  });
});
