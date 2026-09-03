/**
 * Typed builder over the structured filter DSL the search API accepts.
 *   leaf        {"field": name, "<op>": value}
 *   combinator  {"and"|"or"|"not": [nodes]}    (always a list)
 *   ops         eq ne in not_in gt gte lt lte between ([lo, hi])
 *
 *   F('issn').eq('1664-302X').or(F('issn').eq('1932-6203'))
 *   F('journal_metric.2yr_mean_citedness').gte(5).and(F('doi').eq('10.1/x').not())
 */

export type FilterNode = Record<string, unknown>;

export class Filter {
  private constructor(private readonly node: FilterNode) {}

  /** @internal */
  static of(node: FilterNode): Filter { return new Filter(node); }

  toJSON(): FilterNode { return structuredClone(this.node); }

  private combine(op: 'and' | 'or', other: Filter): Filter {
    const only = (n: FilterNode) => Object.keys(n).length === 1 && op in n;
    const left = only(this.node) ? (this.node[op] as FilterNode[]) : [this.node];
    const right = only(other.node) ? (other.node[op] as FilterNode[]) : [other.node];
    return new Filter({ [op]: [...left, ...right] });
  }
  and(other: Filter): Filter { return this.combine('and', other); }
  or(other: Filter): Filter { return this.combine('or', other); }
  not(): Filter { return new Filter({ not: [this.node] }); }
}

export class FieldBuilder {
  constructor(private readonly name: string) {
    if (!name) throw new Error('field name must be a non-empty string');
  }
  private leaf(op: string, value: unknown): Filter { return Filter.of({ field: this.name, [op]: value }); }
  eq(v: unknown): Filter { return this.leaf('eq', v); }
  ne(v: unknown): Filter { return this.leaf('ne', v); }
  in(v: unknown[]): Filter { return this.leaf('in', [...v]); }
  notIn(v: unknown[]): Filter { return this.leaf('not_in', [...v]); }
  gt(v: unknown): Filter { return this.leaf('gt', v); }
  gte(v: unknown): Filter { return this.leaf('gte', v); }
  lt(v: unknown): Filter { return this.leaf('lt', v); }
  lte(v: unknown): Filter { return this.leaf('lte', v); }
  between(lo: unknown, hi: unknown): Filter { return this.leaf('between', [lo, hi]); }
}

export function F(field: string): FieldBuilder { return new FieldBuilder(field); }

/** Accept a builder Filter, a raw object (either DSL form), or null/undefined. */
export function toFilterDict(v: Filter | Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (v == null) return undefined;
  if (v instanceof Filter) return v.toJSON();
  if (typeof v === 'object') return v;
  throw new TypeError(`filters must be a Filter, object or null, got ${typeof v}`);
}
