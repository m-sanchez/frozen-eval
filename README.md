# frozen-eval

![TypeScript](https://img.shields.io/badge/TypeScript-erasable_syntax-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D22.18-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-B45309)
[![CI](https://github.com/m-sanchez/frozen-eval/actions/workflows/test.yml/badge.svg)](https://github.com/m-sanchez/frozen-eval/actions/workflows/test.yml)
![License](https://img.shields.io/badge/license-MIT-6E6E6E)

Evals you cannot quietly bend.

[More tools](https://github.com/m-sanchez) ·
[Working rules](https://miguelsanchez.co.uk/ethics)

An eval proves something only while nobody can move it after seeing a
result. Every guarantee here is mechanical, and each has a failure mode it
exists to close:

- **The corpus and the bars freeze together, in one hash.** A manifest
  binds the item hashes and the pass bars into a single self-verifying
  object, declared before any run. Lowering a bar after a bad result
  breaks the manifest hash, and `verifyManifest` says so to anyone.
- **Runs are fail-closed.** A drifted split refuses to run. A split the
  manifest never froze refuses to run. A bar over a metric the run never
  produced fails, never passes by absence.
- **The holdout answers regressions only.** Splits marked `holdout` at
  freeze time throw unless the run declares `regression: true`; the
  day-to-day loop cannot spend the split that exists to catch it.
- **Results are a hash chain.** The ledger is append-only JSONL where each
  entry commits to the previous one. Editing a past run, deleting an
  inconvenient one, or reordering history breaks the chain at that entry,
  and `verifyLedger` names the line.
- **Leakage exits non-zero, and unknown never becomes pass.** Duplicate
  ids, identical inputs frozen into two splits, near-duplicates across
  splits (character-trigram Dice). The pair-wise near-dup check is
  refused above a documented ceiling (default 5000 items, it is O(n^2)):
  the report says `not-run`, the check fails closed, and the only way
  past is an explicit `--allow-unchecked-near-duplicates`, which the
  report records.

```ts
import { freeze, runEval, appendRun } from 'frozen-eval';

const manifest = freeze(corpus, [
  { metric: 'exact', op: '>=', value: 0.85 },
  { metric: 'latencyMs', op: '<=', value: 2000 }
], { holdout: ['holdout'] });

const run = await runEval({
  manifest, corpus, split: 'val',
  judge: async (item) => ({ exact: await myModelAnswers(item), latencyMs: elapsed }),
  label: 'model-x prompt-v3'
});

run.aggregate.exact;   // { kind: 'rate', value, n, wilson: { low, high } }
run.verdict;           // every bar, with its value, pass or fail
ledger = appendRun(ledger, run);   // the only honest operation the format supports
```

Boolean metrics aggregate to a rate with a Wilson 95% interval (n = 0 is
[0, 1], never a confident point); numeric metrics to a mean; a metric that
mixes the two refuses to aggregate at all. Every bar result carries its
denominator, and a bar may bind the Wilson lower bound instead of the
point estimate (`bound: 'wilson-low'`), so a lucky small-n rate cannot
clear a bar its interval does not support. The judge is yours; every
field it returns becomes a metric a bar can bind.

## CLI

Installed with the package (`npx frozen-eval` after install):

```bash
frozen-eval freeze corpus.json bars.json > manifest.json
frozen-eval verify corpus.json manifest.json   # exit 1 on drift
frozen-eval check corpus.json                  # exit 1 on leakage or an unrun check
frozen-eval verify-ledger runs.jsonl           # exit 1 on a broken chain
```

Exit codes: `0` clean, `1` drift, violation, or broken chain, `2` usage
error - a missing file or bad argument never reads as a pass and never
masquerades as drift.

## Honest limits

- The ledger is rewritable by anyone holding `appendRun`: the chain
  proves that history was not edited in place, not who wrote it. There
  is no signature.
- `freeze()` embeds no timestamp or external anchor; "declared before
  the run" is provable to anyone you gave the manifest to beforehand,
  not from the artifact alone.
- Wilson intervals gate a bar only when the bar opts in with
  `bound: 'wilson-low'`; the default remains the point estimate, and the
  interval is always reported.

## Install

```bash
npm install github:m-sanchez/frozen-eval#v2.0.0
```

Not yet on npm; the pinned git tag is the supported install and CI proves
the packed tarball imports cleanly. Zero runtime dependencies.

## Develop

```bash
npm ci            # dev-only: typescript
npm test
npm run typecheck
```

Node 22.18+ (erasable-syntax TypeScript; node runs the sources directly).

## The tests are the point

| Test | Claim |
| :-- | :-- |
| editing a bar after the freeze is detectable by anyone | the bar lives inside the hash the corpus lives inside |
| a drifted split refuses to run | fail-closed, not fail-quiet |
| the holdout throws without a declared regression | the loop cannot spend its own safety net |
| an edited past run breaks the ledger at that entry | history defends itself, with a line number |
| a deleted run breaks the chain too | absence is as loud as alteration |
| a bar over a missing metric fails | nothing passes by not being measured |
| wilson(0, 0) is [0, 1] | total ignorance is never a confident point |
| a lucky 6-of-7 clears the point bar and fails the wilson-low bar | intervals can gate, not just decorate |
| a mixed boolean/number metric refuses to aggregate | n=1 by accident cannot clear anything |
| an oversized corpus fails leakage closed | a check that could not run is not a check that passed |
| freezing with no bars refuses | an eval with nothing to clear proves nothing |
