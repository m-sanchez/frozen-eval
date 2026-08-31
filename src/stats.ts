/** Statistics and bars. Booleans aggregate to a rate with a Wilson 95%
 * interval, numbers to a mean, and a bar over a missing or NaN metric
 * fails closed: an eval that cannot compute its own number has not
 * cleared anything. */

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
  return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) };
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
    if (booleans.length === values.length && values.length > 0) {
      const k = booleans.filter(Boolean).length;
      out[name] = { kind: 'rate', value: k / booleans.length, n: booleans.length, wilson: wilson(k, booleans.length) };
    } else {
      const numbers = values.filter((v): v is number => typeof v === 'number');
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
  bar: string;
  pass: boolean;
}

export interface Verdict {
  pass: boolean;
  results: BarResult[];
}

export function evaluateBars(agg: Aggregate, bars: Bar[]): Verdict {
  const results: BarResult[] = bars.map((bar) => {
    const metric = agg[bar.metric];
    const value = metric?.value ?? NaN;
    const pass =
      Number.isFinite(value) && (bar.op === '>=' ? value >= bar.value : value <= bar.value);
    return { metric: bar.metric, value, bar: `${bar.op} ${bar.value}`, pass };
  });
  return { pass: results.every((r) => r.pass), results };
}
