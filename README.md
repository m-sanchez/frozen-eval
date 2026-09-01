# frozen-eval

![TypeScript](https://img.shields.io/badge/TypeScript-erasable_syntax-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D22.18-5FA04E?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-B45309)
[![CI](https://github.com/m-sanchez/frozen-eval/actions/workflows/test.yml/badge.svg)](https://github.com/m-sanchez/frozen-eval/actions/workflows/test.yml)
![License](https://img.shields.io/badge/license-MIT-6E6E6E)
[![npm](https://img.shields.io/npm/v/@m-sanchez/frozen-eval?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@m-sanchez/frozen-eval)

> **In plain English:** this locks your test set so it cannot drift or leak into training, giving you evaluation scores you can trust over time.

Evals you cannot quietly bend.

[More tools](https://github.com/m-sanchez) ·
[Working rules](https://miguelsanchez.co.uk/ethics) ·
[Worked example: routing-study](https://github.com/m-sanchez/routing-study)

*Provenance: a fresh, dependency-free implementation of standard methods,
written to test the systems the other tools came from. First published
2026-08-31.*

An eval proves something only while nobody can move it after seeing a
result. Every guarantee here is mechanical, and each has a failure mode it
exists to close:

- **The corpus and the bars freeze together, in one hash.** A manifest
  binds the item hashes and the pass bars into a single self-verifying
  object, declared before any run. Lowering a bar after a bad result
  breaks the manifest hash, and `verifyManifest` says so to anyone.
- **Runs are fail-closed.** A drifted split refuses to run. A split the
  manifest never froze refuses to run. A bar over a metric the run never
  produced fails, never passes by absence - and so does a bar over a metric
  the judge produced for only part of the split. Every metric carries both
  the denominator it was measured on and the one it was expected on, so
  "0.95 over 20 items" and "0.95 over the 5 items the judge did not drop"
  are not the same result. Partial coverage is passable only when the bar
  declared it at freeze time (`minCoverage`), inside the manifest hash.
- **The holdout answers regressions only.** Splits marked `holdout` at
  freeze time throw unless the run declares `regression: true`; the
  day-to-day loop cannot spend the split that exists to catch it.
- **Results are a hash chain, and the chain is not the whole check.** The
  ledger is append-only JSONL where each entry commits to the previous one.
  Editing a past run, deleting an inconvenient one, or reordering history
  breaks the chain at that entry, and `verifyLedger` names the line. But a
  chain only proves nobody edited history after writing it - an entry whose
  aggregate and verdict were written to say whatever was wanted chains
  perfectly well. Hand `verifyLedger` the manifest and it replays instead:
  each aggregate recomputed from the entry's own perItem scores, each
  verdict recomputed from the manifest's own bars, and with `corpus` the
  scored ids held to the ids the split froze. Without a manifest the CLI
  says `chain intact ... (not replayed)`, because that is what it checked.
- **Leakage exits non-zero, and unknown never becomes pass.** Duplicate
  ids, the same input frozen into two splits, the same input twice inside
  one split (which inflates its own denominator), and near-duplicates
  across splits. The pair-wise near-dup check is refused above a documented
  ceiling (default 5000 items, it is O(n^2)): the report says `not-run`,
  the check fails closed, and the only way past is an explicit
  `--allow-unchecked-near-duplicates`, which the report records.

```ts
import { freeze, runEval, appendRun } from '@m-sanchez/frozen-eval';

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

### Near-duplicates on a templated corpus

Similarity is IDF-weighted character-trigram Dice, because almost every eval
corpus is prompt-templated and plain Dice reads the shared instruction header
as evidence of duplication. Measured: four unrelated MCQ questions behind one
142-character header (capital of France, closest planet, who wrote Beloved,
boiling point of water) scored 0.83-0.89 against each other under plain Dice,
so all four cross-split pairs were flagged and `check` could not exit 0 on
that corpus at all. Weighting each trigram by how rare it is across the corpus
sends boilerplate to near-zero weight and leaves the item's own words carrying
the similarity: the same four questions now report clean, and a fifth item
that really is a paraphrase of one of them is still caught.

`nearDuplicateThreshold` (`--near-dup-threshold`, default 0.8) is the dial.
`maxViolations` (default 100) caps how many violation strings are built; the
report always carries the true `violationCount`, so a broken corpus says
`+9900 more violations not listed` instead of printing them.

Timings at the 5000-item ceiling, median of five runs, one core of an Intel
Core Ultra 7 155H under node 24: **2.8 s** for short distinct inputs (~88
characters), **5.6 s** when every item also carries the 142-character header,
which is the worst case - shared boilerplate is exactly what the cheap
skip-this-pair test cannot rule out. Both scale as O(n^2) in items and O(1) in
the length of each.

### Metrics that are not per-item

Calibration error, macro-F1, worst-group gap and pass@k are numbers about
the run, not about any item, so they cannot come out of `judge`. Splicing
one into `run.aggregate` afterwards and calling `evaluateBars` again
produces a verdict that carries no manifest hash and can never enter a
ledger - the one number the eval existed to gate on ends up the one number
outside the freeze. `corpusJudge` runs inside it:

```ts
const run = await runEval({
  manifest, corpus, split: 'val',
  judge: (item) => ({ exact: answer(item) === item.expected }),
  corpusJudge: (perItem) => ({ worstGroupGap: gapAcross(perItem) }),
  label: 'model-x prompt-v3'
});
run.verdict;   // bars over exact AND worstGroupGap, inside the manifest binding
```

It is called once, after the per-item loop, over the scores that loop
produced. A name that collides with a per-item metric throws (a bar could
not say which it meant), a non-finite value throws, and a bar over a metric
the corpus judge did not return fails closed like any other absent metric.

## Canonical bytes

Every hash here - split, manifest, ledger entry - is SHA-256 over one
canonical text, shared with the other packages in this family so the same
object hashes to the same string in all of them:

> Object keys sorted by code unit, no insignificant whitespace,
> undefined-valued properties omitted, strings JSON-escaped, SHA-256 hex over
> UTF-8. Numbers: finite only; -0 normalised to 0; integer-valued numbers must
> be SAFE integers and print as integers; non-integers must satisfy
> `|x| >= 1e-4` and print as the shortest round-trip decimal. The floor exists
> because JS writes `0.000007` where Python writes `7e-06` - refusing those
> values is what makes the byte form portable across languages.

The rule is held to a fixture (`test/fixtures/canonical-form.fixture.json`,
27 accept cases with their expected text and digest, 8 reject cases) that is a
byte-identical copy of the one the sibling packages use.

## CLI

Installed with the package (`npx frozen-eval` after install):

```bash
frozen-eval freeze corpus.json bars.json > manifest.json
frozen-eval verify corpus.json manifest.json   # exit 1 on drift
frozen-eval check corpus.json                  # exit 1 on leakage or an unrun check
frozen-eval verify-ledger runs.jsonl           # exit 1 on a broken chain
frozen-eval verify-ledger runs.jsonl --manifest manifest.json [--corpus corpus.json]
```

Without `--manifest`, `verify-ledger` walks the chain and says so:
`chain intact: 3 run(s) (not replayed; pass --manifest to verify results)`.
With it, every entry's aggregate is recomputed from its own perItem scores
and every verdict from the manifest's own bars before it reports
`ledger verified`.

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
- A corpus-level metric is not derived from any one item, so `verifyLedger`
  cannot recompute it from `perItem` alone: without `corpusJudge` in the
  options it is taken as recorded, and only the verdict that follows from it
  is checked. Hand replay the same `corpusJudge` and it is recomputed like
  everything else.
- The canonical magnitude floor is a real ceiling on run size. A rate below
  `1e-4` cannot be hashed, so a run with exactly one success needs `n < 10001`
  for the rate and `n < 1766` for its Wilson lower bound
  (`wilson(1, 1766).low = 0.00009996`). Past that, `appendRun` refuses the run
  rather than writing bytes another language would read differently. Zero
  successes is fine at any `n`: that bound is exactly 0.

## Install

```bash
npm install @m-sanchez/frozen-eval
```

Also installable from a pinned git tag:
`github:m-sanchez/frozen-eval#v2.0.1`. CI proves the packed tarball imports
cleanly. Zero runtime dependencies.

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
| a ledger of internally consistent lies fails replay, though the chain is intact | the chain proves custody, replay proves arithmetic |
| an entry run against a different manifest is named | a result belongs to the freeze it was run under |
| appendRun refuses to extend a chain that does not verify | you cannot build on a history you cannot vouch for |
| a bar over a missing metric fails | nothing passes by not being measured |
| a metric measured on 5 of 20 items does not clear its bar | 75% absence fails like total absence |
| a bar may opt in to partial coverage, and the opt-in is in the manifest | the exception is declared, not assumed |
| wilson(0, 0) is [0, 1] | total ignorance is never a confident point |
| a lucky 6-of-7 clears the point bar and fails the wilson-low bar | intervals can gate, not just decorate |
| a mixed boolean/number metric refuses to aggregate | n=1 by accident cannot clear anything |
| a corpus-level metric is measured inside the freeze and gates a bar | the headline number is not spliced in afterwards |
| a corpus metric cannot quietly take a per-item metric name | a bar always knows which number it binds |
| replay recomputes a corpus metric when it is handed the same judge | the un-replayable part is named, not assumed |
| an oversized corpus fails leakage closed | a check that could not run is not a check that passed |
| the shared instruction header is not evidence of a near-duplicate | the check survives a real templated corpus |
| a genuinely copied item is still caught behind the same template | discounting boilerplate does not discount leakage |
| an input repeated inside one split is a violation too | a denominator inflated by a copy is not the frozen one |
| the violation list is capped instead of printing four million lines | a broken corpus should be readable |
| freezing with no bars refuses | an eval with nothing to clear proves nothing |
