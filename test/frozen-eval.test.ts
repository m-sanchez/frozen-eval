import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLeakage } from '../src/leakage.ts';
import { appendRun, verifyLedger } from '../src/ledger.ts';
import { FrozenEvalError, freeze, verifyCorpus, verifyManifest } from '../src/manifest.ts';
import type { Corpus, Item } from '../src/manifest.ts';
import { runEval } from '../src/run.ts';
import { evaluateBars, wilson } from '../src/stats.ts';

const item = (id: string, input: string, expected: unknown = null): Item => ({ id, input, expected });

const CORPUS: Corpus = {
  dev: [
    item('d1', 'what is the total for march', 41),
    item('d2', 'list every account mentioned', ['a', 'b']),
    item('d3', 'was there any activity on sunday', false)
  ],
  val: [item('v1', 'sum the april transfers', 12), item('v2', 'who appears most often', 'a')],
  holdout: [item('h1', 'the reserved question', 1)]
};

const BARS = [
  { metric: 'exact', op: '>=' as const, value: 0.6 },
  { metric: 'latencyMs', op: '<=' as const, value: 100 }
];

const manifest = freeze(CORPUS, BARS, { holdout: ['holdout'] });

const perfectJudge = () => ({ exact: true, latencyMs: 5 });

test('freeze binds corpus and bars in one self-verifying hash', () => {
  assert.ok(verifyManifest(manifest));
  assert.equal(manifest.splits.dev.count, 3);
  assert.ok(manifest.splits.holdout.holdout);
});

test('editing a bar after the freeze is detectable by anyone', () => {
  const bent = { ...manifest, bars: [{ ...BARS[0], value: 0.1 }, BARS[1]] };
  assert.ok(!verifyManifest(bent));
});

test('an eval with no bars refuses to freeze', () => {
  assert.throws(() => freeze(CORPUS, []), /nothing to clear proves nothing/);
});

test('a drifted split refuses to run, fail-closed', async () => {
  const drifted = {
    ...CORPUS,
    dev: [...CORPUS.dev.slice(0, 2), item('d3', 'was there any activity on sunday NIGHT', false)]
  };
  await assert.rejects(
    runEval({ manifest, corpus: drifted, split: 'dev', judge: perfectJudge, label: 'x' }),
    /drifted from the freeze/
  );
  assert.ok(verifyCorpus(manifest, drifted).some((p) => p.includes('dev')));
});

test('the holdout answers regressions only', async () => {
  await assert.rejects(
    runEval({ manifest, corpus: CORPUS, split: 'holdout', judge: perfectJudge, label: 'x' }),
    FrozenEvalError
  );
  const run = await runEval({
    manifest,
    corpus: CORPUS,
    split: 'holdout',
    judge: perfectJudge,
    label: 'x',
    regression: true
  });
  assert.ok(run.verdict.pass);
});

test('a green run aggregates rates with Wilson intervals and clears its bars', async () => {
  const run = await runEval({ manifest, corpus: CORPUS, split: 'dev', judge: perfectJudge, label: 'baseline' });
  assert.ok(run.verdict.pass);
  assert.equal(run.aggregate.exact.kind, 'rate');
  assert.ok(run.aggregate.exact.wilson!.low < 1);
  assert.equal(run.identity.manifestHash, manifest.manifestHash);
});

test('a bar over a metric the run never produced fails closed', () => {
  const verdict = evaluateBars({}, [{ metric: 'ghost', op: '>=', value: 0.5 }]);
  assert.ok(!verdict.pass);
});

test('wilson: total ignorance is [0, 1], never a confident point', () => {
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
  const w = wilson(9, 10);
  assert.ok(w.low > 0.55 && w.low < 0.6 && w.high > 0.98);
});

test('the ledger chains, and an edited past run breaks it where it happened', async () => {
  const runA = await runEval({ manifest, corpus: CORPUS, split: 'dev', judge: perfectJudge, label: 'a' });
  const runB = await runEval({ manifest, corpus: CORPUS, split: 'val', judge: perfectJudge, label: 'b' });
  let ledger = appendRun('', runA);
  ledger = appendRun(ledger, runB);
  assert.ok(verifyLedger(ledger).intact);

  const edited = ledger.replace('"label":"a"', '"label":"a-improved"');
  const verdict = verifyLedger(edited);
  assert.ok(!verdict.intact);
  assert.equal(verdict.brokenAt, 0);
  assert.match(verdict.reason!, /edited/);
});

test('deleting an inconvenient run breaks the chain too', async () => {
  const runA = await runEval({ manifest, corpus: CORPUS, split: 'dev', judge: perfectJudge, label: 'a' });
  const runB = await runEval({ manifest, corpus: CORPUS, split: 'val', judge: perfectJudge, label: 'b' });
  const ledger = appendRun(appendRun('', runA), runB);
  const withoutFirst = ledger.split('\n').slice(1).join('\n');
  const verdict = verifyLedger(withoutFirst);
  assert.ok(!verdict.intact);
  assert.match(verdict.reason!, /deletion or reorder/);
});

test('leakage: duplicate ids, identical inputs, and near-duplicates across splits', () => {
  const leaky: Corpus = {
    dev: [item('x1', 'what is the total for march'), item('x2', 'unrelated question here')],
    val: [
      item('x1', 'another phrase entirely'),
      item('v9', 'What is  the total for March'),
      item('v8', 'what is the total for march?!')
    ]
  };
  const report = checkLeakage(leaky);
  assert.ok(!report.clean);
  assert.ok(report.violations.some((v) => v.startsWith('duplicate id')));
  assert.ok(report.violations.some((v) => v.startsWith('identical input')));
  assert.ok(report.violations.some((v) => v.startsWith('near-duplicate')));
});

test('a clean corpus reports clean', () => {
  assert.ok(checkLeakage(CORPUS).clean);
});

test('a mixed boolean/number metric refuses to aggregate', async () => {
  const mixed = [{ exact: true }, { exact: 1 as unknown as boolean }];
  const { aggregate } = await import('../src/stats.ts');
  assert.throws(() => aggregate(mixed), /mixes boolean and number/);
});

test('bar results carry their denominator', async () => {
  const run = await runEval({ manifest, corpus: CORPUS, split: 'dev', judge: perfectJudge, label: 'n-check' });
  for (const r of run.verdict.results) assert.equal(r.n, 3);
});

test('a wilson-low bar refuses what a lucky point estimate would clear', async () => {
  const { aggregate, evaluateBars } = await import('../src/stats.ts');
  const agg = aggregate(Array.from({ length: 7 }, (_, i) => ({ exact: i !== 0 }))); // 6/7 = 0.857
  const point = evaluateBars(agg, [{ metric: 'exact', op: '>=', value: 0.85 }]);
  assert.ok(point.pass, 'the point estimate clears the bar');
  const bound = evaluateBars(agg, [{ metric: 'exact', op: '>=', value: 0.85, bound: 'wilson-low' }]);
  assert.ok(!bound.pass, 'the interval does not support the same claim at n=7');
  assert.ok(bound.results[0].value < 0.6);
});

test('wilson-low over a numeric metric fails closed with the reason named', async () => {
  const { aggregate, evaluateBars } = await import('../src/stats.ts');
  const agg = aggregate([{ latencyMs: 10 }]);
  const verdict = evaluateBars(agg, [{ metric: 'latencyMs', op: '<=', value: 100, bound: 'wilson-low' }]);
  assert.ok(!verdict.pass);
  assert.match(verdict.results[0].detail!, /requires a boolean/);
});

test('an oversized corpus fails leakage closed instead of skipping the near-dup check', () => {
  const big = {
    dev: Array.from({ length: 30 }, (_, i) => item(`b${i}`, `input number ${i} with words`))
  };
  const closed = checkLeakage(big, { maxExhaustiveItems: 10 });
  assert.ok(!closed.clean);
  assert.equal(closed.nearDuplicateCheck.status, 'not-run');
  assert.ok(closed.violations.some((v) => v.includes('unknown is not clean')));

  const overridden = checkLeakage(big, { maxExhaustiveItems: 10, allowUncheckedNearDuplicates: true });
  assert.ok(overridden.clean, 'the override proceeds');
  assert.equal(overridden.nearDuplicateCheck.overridden, true, 'and is recorded in the report');
});

test('CLI: usage errors exit 2 and never masquerade as drift', async () => {
  const { main } = await import('../src/cli.ts');
  assert.equal(main([]), 2);
  assert.equal(main(['freeze']), 2);
  assert.equal(main(['verify', 'no-such-file.json', 'also-missing.json']), 2);
  assert.equal(main(['--help']), 0);
});

test('a run where a metric was false for every item is hashable', async () => {
  // wilson(0, n).low is exactly 0 in algebra; a float residue of 5.5e-17
  // is below the canonical magnitude floor, so the whole run refuses to hash.
  const run = await runEval({
    manifest,
    corpus: CORPUS,
    split: 'dev',
    judge: () => ({ exact: false, latencyMs: 5 }),
    label: 'all-wrong'
  });
  assert.equal(run.aggregate.exact.wilson!.low, 0);
  assert.doesNotThrow(() => appendRun('', run));
});

test('wilson: the algebraic boundaries are exact, not float residue', () => {
  for (let n = 1; n <= 200; n++) {
    assert.equal(wilson(0, n).low, 0, `wilson(0, ${n}).low`);
    assert.equal(wilson(n, n).high, 1, `wilson(${n}, ${n}).high`);
  }
});
