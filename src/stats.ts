/** Statistics and bars. Booleans aggregate to a rate with a Wilson 95%
 * interval, numbers to a mean, and a bar over a missing or NaN metric
 * fails closed: an eval that cannot compute its own number has not
 * cleared anything. */

import { FrozenEvalError } from './manifest.ts';
import type { Bar } from './manifest.ts';

export interface WilsonInterval {
  low: number;
  high: number;
}

const Z = 1.959963984540054; // 95%

/** Wilson score interval for k successes over n trials. n = 0 is total
 * ignorance: [0, 1], never a confident point. */
export function wilson(k: number, n: number): WilsonInterval {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const spread = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At k = 0 the centre and the spread are the same quantity, so the lower
  // bound is exactly 0; at k = n they sum to exactly 1. Computing them
  // separately leaves a float residue (wilson(0, 3).low came out as
  // 5.55e-17), which is a number the canonical form cannot write portably.
  return {
    low: k === 0 ? 0 : Math.max(0, centre - spread),
    high: k === n ? 1 : Math.min(1, centre + spread)
  };
}

export type ItemScores = Record<string, boolean | number>;

export interface MetricAggregate {
  kind: 'rate' | 'mean';
  value: number;
  n: number;
  wilson?: WilsonInterval;
}

export type Aggregate = Record<string, MetricAggregate>;

export function aggregate(perItem: ItemScores[]): Aggregate {
  const out: Aggregate = {};
  const names = new Set(perItem.flatMap((s) => Object.keys(s)));
  for (const name of names) {
    const values = perItem.map((s) => s[name]).filter((v) => v !== undefined);
    const booleans = values.filter((v): v is boolean => typeof v === 'boolean');
    const numbers = values.filter((v): v is number => typeof v === 'number');
    if (booleans.length > 0 && numbers.length > 0) {
      // A judge that returns true for nine items and 1 for the tenth would
      // silently aggregate to a mean over one value and clear its bar at
      // n=1. Refusing here is the whole point of the package.
      throw new FrozenEvalError(
        `metric "${name}" mixes boolean and number values; a mixed metric cannot aggregate honestly`
      );
    }
    if (booleans.length > 0) {
      const k = booleans.filter(Boolean).length;
      out[name] = { kind: 'rate', value: k / booleans.length, n: booleans.length, wilson: wilson(k, booleans.length) };
    } else {
      out[name] = {
        kind: 'mean',
        value: numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : NaN,
        n: numbers.length
      };
    }
  }
  return out;
}

export interface BarResult {
  metric: string;
  value: number;
  /** the denominator behind the value; a number without one is not evidence */
  n: number;
  bar: string;
  pass: boolean;
  detail?: string;
}

export interface Verdict {
  pass: boolean;
  results: BarResult[];
}

export function evaluateBars(agg: Aggregate, bars: Bar[]): Verdict {
  const results: BarResult[] = bars.map((bar) => {
    const metric = agg[bar.metric];
    const bound = bar.bound ?? 'point';
    const barText = `${bar.op} ${bar.value}${bound === 'wilson-low' ? ' (wilson lower bound)' : ''}`;
    if (metric == null) {
      return { metric: bar.metric, value: NaN, n: 0, bar: barText, pass: false, detail: 'metric never produced' };
    }
    if (bound === 'wilson-low' && metric.kind !== 'rate') {
      return {
        metric: bar.metric,
        value: metric.value,
        n: metric.n,
        bar: barText,
        pass: false,
        detail: 'wilson-low bound requires a boolean (rate) metric'
      };
    }
    const value = bound === 'wilson-low' ? metric.wilson!.low : metric.value;
    const pass =
      Number.isFinite(value) && (bar.op === '>=' ? value >= bar.value : value <= bar.value);
    return { metric: bar.metric, value, n: metric.n, bar: barText, pass };
  });
  return { pass: results.every((r) => r.pass), results };
}
