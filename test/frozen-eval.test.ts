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
