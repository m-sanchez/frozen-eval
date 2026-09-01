/** The runner. Fail-closed at every door: a drifted corpus does not run, a
 * split the manifest never froze does not run, and the holdout answers
 * regressions only - the day-to-day loop cannot spend it. */

import { splitHash, verifyManifest, FrozenEvalError } from './manifest.ts';
import type { Corpus, Item, Manifest } from './manifest.ts';
import { aggregate, evaluateBars } from './stats.ts';
import type { Aggregate, ItemScores, Verdict } from './stats.ts';

export type CorpusScores = Record<string, number>;

export interface RunIdentity {
  label: string;
  split: string;
  itemCount: number;
  manifestHash: string;
  node: string;
  platform: string;
  extras?: Record<string, string>;
}

export interface EvalRun {
  identity: RunIdentity;
  perItem: Array<{ id: string; scores: ItemScores }>;
  aggregate: Aggregate;
  verdict: Verdict;
}

export interface RunInput {
  manifest: Manifest;
  corpus: Corpus;
  split: string;
  /** score one item; every returned field becomes a metric */
  judge: (item: Item) => ItemScores | Promise<ItemScores>;
  /** score the run as a whole. Calibration error, macro-F1, worst-group
   * gap, pass@k: numbers that are not any item's score and so cannot come
   * out of `judge`. Called once, after the per-item loop, over the scores
   * it produced; every field becomes a metric a bar can bind, inside the
   * manifest binding and inside the EvalRun that goes into the ledger.
   * Splicing such a metric in afterwards puts it outside the freeze. */
  corpusJudge?: (perItem: EvalRun['perItem']) => CorpusScores | Promise<CorpusScores>;
  /** who or what ran: model id, config, prompt version - your words */
  label: string;
  /** required to touch a holdout split */
  regression?: boolean;
  extras?: Record<string, string>;
}

/** Fold corpus-level numbers into the aggregate. A collision with a
 * per-item metric is refused rather than resolved: a bar naming the metric
 * could not say which of the two it meant. */
export function mergeCorpusScores(agg: Aggregate, scores: CorpusScores, expectedN: number): Aggregate {
  for (const [name, value] of Object.entries(scores)) {
    if (name in agg) {
      throw new FrozenEvalError(
        `corpus metric "${name}" collides with a per-item metric of the same name; a bar could not say which it meant`
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new FrozenEvalError(
        `corpus metric "${name}" is ${String(value)}, not a finite number; an eval that cannot compute its own number has not cleared anything`
      );
    }
    agg[name] = { kind: 'mean', value, n: expectedN, expected: expectedN, source: 'corpus' };
  }
  return agg;
}

export async function runEval(input: RunInput): Promise<EvalRun> {
  const { manifest, corpus, split, judge, label } = input;
  if (!verifyManifest(manifest)) {
    throw new FrozenEvalError('manifest hash does not match its own body; the freeze is broken');
  }
  const frozen = manifest.splits[split];
  if (!frozen) throw new FrozenEvalError(`split "${split}" was never frozen; there is nothing to run against`);
  const items = corpus[split];
  if (!items) throw new FrozenEvalError(`split "${split}" is not in the supplied corpus`);
  if (splitHash(items) !== frozen.hash) {
    throw new FrozenEvalError(`split "${split}" drifted from the freeze; refusing to run`);
  }
  if (frozen.holdout && input.regression !== true) {
    throw new FrozenEvalError(
      `split "${split}" is the holdout: it answers regressions only, and this run did not declare one`
    );
  }

  const perItem: EvalRun['perItem'] = [];
  for (const item of items) {
    perItem.push({ id: item.id, scores: await judge(item) });
  }
  const agg = aggregate(
    perItem.map((p) => p.scores),
    items.length
  );
  if (input.corpusJudge) {
    mergeCorpusScores(agg, await input.corpusJudge(perItem), items.length);
  }
  return {
    identity: {
      label,
      split,
      itemCount: items.length,
      manifestHash: manifest.manifestHash,
      node: process.version,
      platform: process.platform,
      ...(input.extras ? { extras: input.extras } : {})
    },
    perItem,
    aggregate: agg,
    verdict: evaluateBars(agg, manifest.bars)
  };
}
