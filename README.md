# frozen-eval

![TypeScript](https://img.shields.io/badge/TypeScript-erasable_syntax-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D22.6-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-B45309)
![Tests](https://img.shields.io/badge/tests-12_passing-2F6F44)
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
- **Leakage exits non-zero.** Duplicate ids, identical inputs frozen into
  two splits, near-duplicates across splits (character-trigram Dice).

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
[0, 1], never a confident point); numeric metrics to a mean. The judge is
yours; every field it returns becomes a metric a bar can bind.

## CLI

```bash
node --experimental-strip-types bin/frozen-eval.ts freeze corpus.json bars.json > manifest.json
node --experimental-strip-types bin/frozen-eval.ts verify corpus.json manifest.json   # exit 1 on drift
node --experimental-strip-types bin/frozen-eval.ts check corpus.json                  # exit 1 on leakage
node --experimental-strip-types bin/frozen-eval.ts verify-ledger runs.jsonl           # exit 1 on a broken chain
```

## Run

```bash
npm install       # dev-only: typescript
npm test
npm run typecheck
```

Node 22.6+ (erasable-syntax TypeScript, node runs it directly). Zero
runtime dependencies.

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
| freezing with no bars refuses | an eval with nothing to clear proves nothing |
