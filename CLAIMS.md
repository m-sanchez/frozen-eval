# Claims

Every externally falsifiable behavioural claim this package makes - in
`README.md` and in the `description` field of `package.json` - and the
executable test that holds it up. If a row has no test, it says so and says
why.

Run them all with `npm test`. Every `file::test` reference below is
checked against the suite by `test/claims.test.ts`, so a row cannot outlive
the test it names. The CLI rows are additionally
re-run by CI against the binary installed from the packed tarball, not just
against the sources: `.github/workflows/test.yml`, step *exit-code
contract, against the installed binary*.

## package.json `description`

> Evals you cannot quietly bend: corpus and bars frozen in one hash,
> fail-closed runs, a hash-chained results ledger, leakage checks that exit
> non-zero.

| Claim | Test |
| :-- | :-- |
| corpus and bars frozen in one hash | `test/frozen-eval.test.ts::freeze binds corpus and bars in one self-verifying hash` |
| …and moving a bar afterwards is detectable | `test/frozen-eval.test.ts::editing a bar after the freeze is detectable by anyone` |
| fail-closed runs | `test/frozen-eval.test.ts::a drifted split refuses to run, fail-closed` |
| a hash-chained results ledger | `test/frozen-eval.test.ts::the ledger chains, and an edited past run breaks it where it happened` |
| leakage checks that exit non-zero | `scripts/cli-contract.mjs` case *a duplicated id across splits*, driven by `test/cli.test.ts::the documented exit codes hold against the CLI` |

## The freeze

| Claim | Test |
| :-- | :-- |
| a manifest binds item hashes and bars into one self-verifying object | `test/frozen-eval.test.ts::freeze binds corpus and bars in one self-verifying hash` |
| lowering a bar after a bad result breaks the manifest hash | `test/frozen-eval.test.ts::editing a bar after the freeze is detectable by anyone` |
| an eval with no bars refuses to freeze | `test/frozen-eval.test.ts::an eval with no bars refuses to freeze` |
| a `minCoverage` opt-in lives inside the manifest hash like any other bar field | `test/frozen-eval.test.ts::a bar may opt in to partial coverage, and the opt-in is in the manifest` |
| a freeze refuses a corpus of the wrong shape rather than certifying it | `test/cli.test.ts::a valid-JSON file of the wrong shape is a usage error, not drift` |

## Fail-closed runs

| Claim | Test |
| :-- | :-- |
| a drifted split refuses to run | `test/frozen-eval.test.ts::a drifted split refuses to run, fail-closed` |
| a split the manifest never froze refuses to run | `test/frozen-eval.test.ts::a split the manifest never froze refuses to run` |
| a bar over a metric the run never produced fails, never passes by absence | `test/frozen-eval.test.ts::a bar over a metric the run never produced fails closed` |
| a bar over a metric produced for only part of the split fails too | `test/frozen-eval.test.ts::a metric measured on 5 of 20 items does not clear its bar` |
| every metric carries the denominator it was measured on **and** the one it was expected on | same test (asserts `n` = 5, `expected` = 20, `itemCount` = 20) |
| partial coverage passes only when the bar declared it | `test/frozen-eval.test.ts::a bar may opt in to partial coverage, and the opt-in is in the manifest` |
| every bar result carries its denominator | `test/frozen-eval.test.ts::bar results carry their denominator` |
| the holdout throws unless the run declares `regression: true` | `test/frozen-eval.test.ts::the holdout answers regressions only` |

## Statistics

| Claim | Test |
| :-- | :-- |
| boolean metrics aggregate to a rate with a Wilson 95% interval | `test/frozen-eval.test.ts::a green run aggregates rates with Wilson intervals and clears its bars` |
| numeric metrics aggregate to a mean | `test/frozen-eval.test.ts::numeric metrics aggregate to a mean over the values that were produced` |
| a metric mixing booleans and numbers refuses to aggregate at all | `test/frozen-eval.test.ts::a mixed boolean/number metric refuses to aggregate` |
| `wilson(0, 0)` is `[0, 1]`, never a confident point | `test/frozen-eval.test.ts::wilson: total ignorance is [0, 1], never a confident point` |
| `bound: 'wilson-low'` refuses what a lucky point estimate would clear | `test/frozen-eval.test.ts::a wilson-low bar refuses what a lucky point estimate would clear` |
| a `wilson-low` bar over a numeric metric fails closed, with the reason named | `test/frozen-eval.test.ts::wilson-low over a numeric metric fails closed with the reason named` |
| the Wilson bounds are exact at `k = 0` and `k = n`, so an all-false run is hashable | `test/frozen-eval.test.ts::wilson: the algebraic boundaries are exact, not float residue`, `test/frozen-eval.test.ts::a run where a metric was false for every item is hashable` |

## Corpus-level metrics

| Claim | Test |
| :-- | :-- |
| a `corpusJudge` metric is measured inside the freeze and can gate a bar | `test/corpus-metrics.test.ts::a corpus-level metric is measured inside the freeze and gates a bar` |
| …and the resulting run goes into a ledger and survives replay | same test (`appendRun` then `verifyLedger` with the manifest and corpus) |
| a corpus metric colliding with a per-item metric name throws | `test/corpus-metrics.test.ts::a corpus metric cannot quietly take a per-item metric name` |
| a non-finite corpus metric throws | `test/corpus-metrics.test.ts::a corpus metric that is not a finite number refuses the run` |
| a bar over a corpus metric the judge did not return fails closed | `test/corpus-metrics.test.ts::a corpus bar that the corpus judge did not answer fails closed` |

## The ledger

| Claim | Test |
| :-- | :-- |
| editing a past run breaks the chain at that entry, and names the line | `test/frozen-eval.test.ts::the ledger chains, and an edited past run breaks it where it happened` |
| deleting an inconvenient run breaks the chain | `test/frozen-eval.test.ts::deleting an inconvenient run breaks the chain too` |
| reordering history breaks the chain | `test/frozen-eval.test.ts::reordering two runs breaks the chain as loudly as deleting one` |
| a chain alone does not prove an entry was ever true | `test/ledger.test.ts::a ledger of internally consistent lies fails replay, though the chain is intact` |
| with a manifest, each aggregate is recomputed from the entry's own perItem scores | same test (`reason` names the aggregate) |
| with a manifest, each verdict is recomputed from the manifest's own bars | `test/ledger.test.ts::a fabricated verdict over an honest aggregate fails replay` |
| an entry naming a different manifest is named | `test/ledger.test.ts::an entry run against a different manifest is named` |
| with a corpus, the scored ids are held to the ids the split froze | `test/ledger.test.ts::replay checks the perItem ids against the frozen split` |
| an honest ledger replays clean | `test/ledger.test.ts::an honest ledger replays clean` |
| `appendRun` refuses to extend a chain that does not verify | `test/ledger.test.ts::appendRun refuses to extend a chain that does not verify` |
| without a manifest the CLI says it did not replay | `scripts/cli-contract.mjs` case *an honest chain, and it says it did not replay* (asserts the `not replayed` wording) |
| replay recomputes a corpus metric when handed the same `corpusJudge` | `test/corpus-metrics.test.ts::replay recomputes a corpus metric when it is handed the same judge` |

## Leakage

| Claim | Test |
| :-- | :-- |
| duplicate ids across splits are a violation | `test/frozen-eval.test.ts::leakage: duplicate ids, identical inputs, and near-duplicates across splits` |
| the same input frozen into two splits is a violation | same test |
| near-duplicates across splits are a violation | same test |
| the same input twice inside one split is a violation | `test/leakage.test.ts::an input repeated inside one split is a violation too` |
| a clean corpus reports clean | `test/frozen-eval.test.ts::a clean corpus reports clean` |
| a shared instruction header is not evidence of a near-duplicate | `test/leakage.test.ts::the shared instruction header is not evidence of a near-duplicate` |
| a genuine paraphrase behind that same header is still caught | `test/leakage.test.ts::a genuinely copied item is still caught behind the same template` |
| discounting boilerplate does not weaken the check on corpora that have none | `test/leakage.test.ts::near-duplicates are still caught with no template to discount` |
| `nearDuplicateThreshold` / `--near-dup-threshold` is the dial | `test/leakage.test.ts::the near-duplicate threshold is a parameter`; the flag itself in `scripts/cli-contract.mjs` case *and not clean at a threshold of 0.2* |
| `maxViolations` caps the list and the report keeps the true `violationCount` | `test/leakage.test.ts::the violation list is capped instead of printing four million lines` |
| above the ceiling the check fails closed, and the override is recorded | `test/frozen-eval.test.ts::an oversized corpus fails leakage closed instead of skipping the near-dup check` |

## Canonical bytes

| Claim | Test |
| :-- | :-- |
| the stated rule is what `canonicalize` does, text and digest, over 27 cases | `test/canonical-form.test.ts::canonical form: every accept case matches the shared fixture, text and hash` |
| the 8 refusals (non-finite, unsafe integer, below floor, unsupported type) | `test/canonical-form.test.ts::canonical form: every reject case throws` |
| `-0` normalises to `0` and undefined-valued properties are omitted | `test/canonical-form.test.ts::canonical form: the cases JSON cannot express` |
| the floor bites at exactly `n < 10001` for a 1-success rate and `n < 1766` for its Wilson lower bound | `test/claims.test.ts::the canonical magnitude floor bites exactly where Honest limits says` |
| zero successes is hashable at any `n` | same test |

## CLI

| Claim | Test |
| :-- | :-- |
| `0` clean, `1` drift/violation/broken chain, `2` usage error | `test/cli.test.ts::the documented exit codes hold against the CLI`, running all 27 cases in `scripts/cli-contract.mjs` |
| a usage error never reads as a pass and never masquerades as drift | `test/frozen-eval.test.ts::CLI: usage errors exit 2 and never masquerade as drift`, plus the eight exit-2 cases in the contract |
| a valid-JSON file of the wrong shape is a usage error, not drift | `test/cli.test.ts::a valid-JSON file of the wrong shape is a usage error, not drift` |
| `example/corpus.json` and `example/bars.json` are the shapes the CLI expects | `scripts/cli-contract.mjs` reads both and freezes, verifies and checks them |
| the contract runs the number of cases the README states | `test/claims.test.ts::the README states the number of cases the exit-code contract actually runs` |
| importing the library does not run the CLI or end the host process | `test/cli.test.ts::the entrypoint guard compares paths, not basenames`; end to end for host scripts named `cli.js` and `cli.ts` in `test/cli.test.ts`, and for `cli.js`, `cli.ts` and `index.js` in the contract |

## Packaging

| Claim | Test |
| :-- | :-- |
| zero runtime dependencies (badge, README, provenance note) | `test/claims.test.ts::zero runtime dependencies, as the badge and the README both say` (package.json **and** the lockfile) |
| erasable-syntax TypeScript, node runs the sources directly | `test/claims.test.ts::the erasable-syntax badge is a compiler setting, not a promise`, and `npm run typecheck` in CI |
| node >= 22.18 | `test/claims.test.ts::the README pins the version the package actually is` (engines), CI matrix 22/24/26 |
| the pinned git tag in the README is the version the package is at | same test |
| the packed tarball imports cleanly | `.github/workflows/test.yml`, step *install proof* |
| `perItem` maps to ab-significance's `Outcome` in one line | `test/frozen-eval.test.ts::perItem maps to ab-significance's Outcome in one line` (shape only - see below) |

## Stated, but not enforced by a test here

| Claim | Why not, and what stands behind it |
| :-- | :-- |
| plain Dice scored 0.83-0.89 on four unrelated MCQ questions behind a 142-character header | a measurement of the algorithm this release replaced. The corpus is the fixture at the top of `test/leakage.test.ts`, so the number is reproducible, but there is nothing left in the package that produces it. |
| 2.8 s / 5.6 s for 5000 items on an Intel Core Ultra 7 155H under node 24 | wall-clock, median of five runs. A timing assertion in CI would be flaky on shared runners and would fail for reasons that are not this package's. The method and the machine are stated so the number can be re-measured. |
| the canonical fixture is a byte-identical copy of the sibling packages' | cannot be checked from inside one repo. `.gitattributes` pins the file to `-text` so no checkout rewrites its line endings, and the tests assert its 27 + 8 case counts. |
| the ab-significance bridge type-checks against that package's `Outcome` | ab-significance is not a dependency of this package and adding one to test a README snippet would cost more than it proves. The test asserts the shape the adapter produces: `{ id: string, correct: boolean \| undefined }`, with a skipped item arriving as `undefined`. |
| the ledger has no signature; `freeze()` embeds no timestamp | statements of what is *absent*, in *Honest limits*. There is nothing to execute; they exist so nobody infers a guarantee that was never made. |
| MIT licence, first published 2026-08-31 | facts about the repository, not behaviour: `LICENSE`, and git history. |
