/** Corpus-level metrics: calibration error, macro-F1, worst-group gap.
 * None of them is a per-item score, and before corpusJudge the only way to
 * bar on one was to splice it into the aggregate after runEval returned and
 * call evaluateBars again - producing a verdict that carried no manifest
 * hash and could never enter a ledger. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, verifyLedger } from '../src/ledger.ts';
import { freeze } from '../src/manifest.ts';
import type { Corpus, Item } from '../src/manifest.ts';
import { runEval } from '../src/run.ts';
import type { EvalRun } from '../src/run.ts';

const item = (id: string, input: string, expected: unknown = null): Item => ({ id, input, expected });

/** two groups, a/ and b/, so a group gap is a real corpus-level number */
const CORPUS: Corpus = {
  dev: [
    item('a1', 'first question for group a'),
    item('a2', 'second question for group a'),
    item('b1', 'first question for group b'),
    item('b2', 'second question for group b')
  ]
};

/** the largest gap between any two groups' accuracy - not a per-item score */
const worstGroupGap = (perItem: EvalRun['perItem']): Record<string, number> => {
  const byGroup = new Map<string, boolean[]>();
  for (const p of perItem) {
    const group = p.id[0];
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(p.scores.exact === true);
  }
  const rates = [...byGroup.values()].map((hits) => hits.filter(Boolean).length / hits.length);
  return { worstGroupGap: Math.max(...rates) - Math.min(...rates) };
};

const BARS = [
  { metric: 'exact', op: '>=' as const, value: 0.5 },
  { metric: 'worstGroupGap', op: '<=' as const, value: 0.6 }
];
const manifest = freeze(CORPUS, BARS);

test('a corpus-level metric is measured inside the freeze and gates a bar', async () => {
  const run = await runEval({
    manifest,
    corpus: CORPUS,
    split: 'dev',
    judge: (it) => ({ exact: it.id !== 'b2' }), // group a 2/2, group b 1/2 -> gap 0.5
    corpusJudge: worstGroupGap,
    label: 'grouped'
  });
  assert.equal(run.aggregate.worstGroupGap.value, 0.5);
  assert.equal(run.aggregate.worstGroupGap.source, 'corpus');
  assert.equal(run.aggregate.worstGroupGap.n, 4);
  assert.ok(run.verdict.pass, 'the gap clears its bar inside the run');
  assert.equal(run.identity.manifestHash, manifest.manifestHash);

  // and, being inside the run, it goes in the ledger and survives replay
  const ledger = appendRun('', run);
  const replay = verifyLedger(ledger, { manifest, corpus: CORPUS });
  assert.ok(replay.intact, replay.reason ?? 'replay failed');
});

test('a corpus bar that the corpus judge did not answer fails closed', async () => {
  const run = await runEval({
    manifest,
    corpus: CORPUS,
    split: 'dev',
    judge: () => ({ exact: true }),
    corpusJudge: () => ({}),
    label: 'silent-corpus-judge'
  });
  assert.ok(!run.verdict.pass);
  const gap = run.verdict.results.find((r) => r.metric === 'worstGroupGap')!;
  assert.match(gap.detail!, /never produced/);
});

test('a corpus metric cannot quietly take a per-item metric name', async () => {
  await assert.rejects(
    runEval({
      manifest,
      corpus: CORPUS,
      split: 'dev',
      judge: () => ({ exact: true }),
      corpusJudge: () => ({ exact: 1 }),
      label: 'collision'
    }),
    /collides/
  );
});

test('a corpus metric that is not a finite number refuses the run', async () => {
  await assert.rejects(
    runEval({
      manifest,
      corpus: CORPUS,
      split: 'dev',
      judge: () => ({ exact: true }),
      corpusJudge: () => ({ worstGroupGap: NaN }),
      label: 'nan'
    }),
    /finite/
  );
});

test('replay recomputes a corpus metric when it is handed the same judge', async () => {
  const run = await runEval({
    manifest,
    corpus: CORPUS,
    split: 'dev',
    judge: (it) => ({ exact: it.id !== 'b2' }),
    corpusJudge: worstGroupGap,
    label: 'grouped'
  });
  const bent = JSON.parse(JSON.stringify(run)) as EvalRun;
  bent.aggregate.worstGroupGap.value = 0.1; // a gap nobody measured
  bent.verdict = {
    pass: true,
    results: [
      { metric: 'exact', value: 0.75, n: 4, expected: 4, bar: '>= 0.5', pass: true },
      { metric: 'worstGroupGap', value: 0.1, n: 4, expected: 4, bar: '<= 0.6', pass: true }
    ]
  };
  const ledger = appendRun('', bent);
  assert.ok(
    verifyLedger(ledger, { manifest, corpus: CORPUS }).intact,
    'without the judge, a corpus metric can only be taken as recorded'
  );
  const withJudge = verifyLedger(ledger, { manifest, corpus: CORPUS, corpusJudge: worstGroupGap });
  assert.ok(!withJudge.intact);
  assert.match(withJudge.reason!, /worstGroupGap/);
});
