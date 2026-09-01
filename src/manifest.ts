/** The freeze. A manifest binds the corpus and the bars in one hash,
 * before any run exists. That is the whole discipline in one object: you
 * cannot lower a bar after seeing a result without the manifest saying so,
 * because the bar lives inside the thing the corpus hash lives inside. */

import { hashOf } from './canonical.ts';

export interface Item {
  id: string;
  input: string;
  /** whatever your judge needs; hashed as part of the split */
  expected: unknown;
}

export type Corpus = Record<string, Item[]>;

export interface Bar {
  metric: string;
  op: '>=' | '<=';
  value: number;
  /** 'point' (default) compares the point estimate; 'wilson-low' compares
   * the Wilson 95% lower bound, so a lucky small-n rate cannot clear a bar
   * its interval does not support. Rate metrics only. */
  bound?: 'point' | 'wilson-low';
  /** the fraction of the split the metric must actually be produced for,
   * in (0, 1]. Default 1: a judge that skipped items has not measured the
   * split, and a bar over a partial denominator refuses rather than passes.
   * Lowering it is a declaration, made at freeze time and inside the
   * manifest hash like every other bar field. */
  minCoverage?: number;
  note?: string;
}

export interface Manifest {
  version: 1;
  splits: Record<string, { count: number; hash: string; holdout: boolean }>;
  bars: Bar[];
  manifestHash: string;
}

export class FrozenEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrozenEvalError';
  }
}

export function splitHash(items: Item[]): string {
  const canonicalOrder = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hashOf(canonicalOrder.map((it) => ({ id: it.id, input: it.input, expected: it.expected })));
}

/** Freeze a corpus with its bars. Holdout splits are named at freeze time;
 * the runner will refuse them outside regression mode. */
export function freeze(corpus: Corpus, bars: Bar[], opts: { holdout?: string[] } = {}): Manifest {
  const holdout = new Set(opts.holdout ?? []);
  for (const name of holdout) {
    if (!(name in corpus)) throw new FrozenEvalError(`holdout split "${name}" is not in the corpus`);
  }
  if (bars.length === 0) {
    throw new FrozenEvalError('no bars declared; an eval with nothing to clear proves nothing');
  }
  for (const bar of bars) {
    if (bar.minCoverage === undefined) continue;
    if (!(Number.isFinite(bar.minCoverage) && bar.minCoverage > 0 && bar.minCoverage <= 1)) {
      throw new FrozenEvalError(
        `bar on "${bar.metric}" declares minCoverage ${bar.minCoverage}; it must be in (0, 1]`
      );
    }
  }
  const splits: Manifest['splits'] = {};
  for (const [name, items] of Object.entries(corpus)) {
    splits[name] = { count: items.length, hash: splitHash(items), holdout: holdout.has(name) };
  }
  const body = { version: 1 as const, splits, bars };
  return { ...body, manifestHash: hashOf(body) };
}

/** Integrity of the manifest itself, then of a corpus against it. */
export function verifyManifest(manifest: Manifest): boolean {
  const { manifestHash, ...body } = manifest;
  return hashOf(body) === manifestHash;
}

export function verifyCorpus(manifest: Manifest, corpus: Corpus): string[] {
  const problems: string[] = [];
  if (!verifyManifest(manifest)) problems.push('manifest hash does not match its own body');
  for (const [name, meta] of Object.entries(manifest.splits)) {
    const items = corpus[name];
    if (!items) {
      problems.push(`split "${name}" missing from corpus`);
      continue;
    }
    if (items.length !== meta.count) problems.push(`split "${name}": ${items.length} items, frozen ${meta.count}`);
    if (splitHash(items) !== meta.hash) problems.push(`split "${name}": hash drift from the freeze`);
  }
  return problems;
}
