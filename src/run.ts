/** The runner. Fail-closed at every door: a drifted corpus does not run, a
 * split the manifest never froze does not run, and the holdout answers
 * regressions only - the day-to-day loop cannot spend it. */

import { splitHash, verifyManifest, FrozenEvalError } from './manifest.ts';
import type { Corpus, Item, Manifest } from './manifest.ts';
import { aggregate, evaluateBars } from './stats.ts';
import type { Aggregate, ItemScores, Verdict } from './stats.ts';

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
  /** who or what ran: model id, config, prompt version - your words */
  label: string;
  /** required to touch a holdout split */
  regression?: boolean;
  extras?: Record<string, string>;
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
  const agg = aggregate(perItem.map((p) => p.scores));
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
