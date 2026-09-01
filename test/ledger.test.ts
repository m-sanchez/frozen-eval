/** The ledger's chain proves nobody edited history after writing it. It
 * does not prove any entry was ever true. Replay is the part an auditor
 * actually asked about. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, verifyLedger } from '../src/ledger.ts';
import { freeze } from '../src/manifest.ts';
import type { Corpus, Item } from '../src/manifest.ts';
import { runEval } from '../src/run.ts';
import type { EvalRun } from '../src/run.ts';

const item = (id: string, input: string, expected: unknown = null): Item => ({ id, input, expected });

const CORPUS: Corpus = {
  dev: [item('d1', 'what is the total for march'), item('d2', 'list every account mentioned')],
  val: [item('v1', 'sum the april transfers'), item('v2', 'who appears most often')]
};
const BARS = [{ metric: 'exact', op: '>=' as const, value: 0.9 }];
const manifest = freeze(CORPUS, BARS);

const failingRun = (): Promise<EvalRun> =>
  runEval({ manifest, corpus: CORPUS, split: 'dev', judge: () => ({ exact: false }), label: 'honest' });

const clone = (run: EvalRun): EvalRun => JSON.parse(JSON.stringify(run)) as EvalRun;

test('a ledger of internally consistent lies fails replay, though the chain is intact', async () => {
  const run = await failingRun();
  assert.ok(!run.verdict.pass, 'the honest run fails its bar');

  const bent = clone(run);
  bent.aggregate.exact = { kind: 'rate', value: 1, n: 2, expected: 2, wilson: { low: 1, high: 1 } };
  bent.verdict = {
    pass: true,
    results: [{ metric: 'exact', value: 1, n: 2, expected: 2, bar: '>= 0.9', pass: true }]
  };
  const ledger = appendRun('', bent);

  const chain = verifyLedger(ledger);
  assert.ok(chain.intact, 'nothing was edited after the entry was written');
  assert.equal(chain.replayed, false, 'and nothing was recomputed');

  const replay = verifyLedger(ledger, { manifest });
  assert.ok(!replay.intact, 'the recorded aggregate contradicts the entry own perItem scores');
  assert.equal(replay.replayed, true);
  assert.equal(replay.brokenAt, 0);
  assert.match(replay.reason!, /aggregate/);
});

test('a fabricated verdict over an honest aggregate fails replay', async () => {
  const run = await failingRun();
  const bent = clone(run);
  bent.verdict = {
    pass: true,
    results: [{ metric: 'exact', value: 0, n: 2, expected: 2, bar: '>= 0.9', pass: true }]
  };
  const replay = verifyLedger(appendRun('', bent), { manifest });
  assert.ok(!replay.intact);
  assert.match(replay.reason!, /verdict/);
});

test('an entry run against a different manifest is named', async () => {
  const run = await failingRun();
  const other = freeze(CORPUS, [{ metric: 'exact', op: '>=', value: 0.5 }]);
  const replay = verifyLedger(appendRun('', run), { manifest: other });
  assert.ok(!replay.intact);
  assert.match(replay.reason!, /manifest/);
});

test('replay checks the perItem ids against the frozen split', async () => {
  const run = await failingRun();
  const bent = clone(run);
  bent.perItem = [
    { id: 'd1', scores: { exact: false } },
    { id: 'not-in-the-split', scores: { exact: false } }
  ];
  const replay = verifyLedger(appendRun('', bent), { manifest, corpus: CORPUS });
  assert.ok(!replay.intact);
  assert.match(replay.reason!, /not-in-the-split/);
});

test('an honest ledger replays clean', async () => {
  const a = await failingRun();
  const b = await runEval({
    manifest,
    corpus: CORPUS,
    split: 'val',
    judge: () => ({ exact: true }),
    label: 'better'
  });
  const ledger = appendRun(appendRun('', a), b);
  const replay = verifyLedger(ledger, { manifest, corpus: CORPUS });
  assert.ok(replay.intact, replay.reason ?? 'replay failed');
  assert.equal(replay.entries, 2);
  assert.equal(replay.replayed, true);
});

test('appendRun refuses to extend a chain that does not verify', async () => {
  const run = await failingRun();
  const ledger = appendRun('', run);
  const tampered = ledger.replace('"label":"honest"', '"label":"honest!"');
  assert.throws(() => appendRun(tampered, run), /entry 0/);
});
