/** Leakage: the check has to survive contact with a real corpus. Almost
 * every eval corpus is prompt-templated, so a similarity measure that reads
 * the shared instruction header as evidence of duplication flags everything
 * and gets deleted from CI. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLeakage } from '../src/leakage.ts';
import type { Corpus, Item } from '../src/manifest.ts';

const item = (id: string, input: string, expected: unknown = null): Item => ({ id, input, expected });

const HEADER =
  'Answer the following multiple-choice question. Reply with only the letter of the ' +
  'correct option, no explanation and no other text.\n\nQuestion: ';

const templated = (id: string, question: string): Item => item(id, HEADER + question);

/** four unrelated questions behind one instruction header */
const TEMPLATED: Corpus = {
  dev: [
    templated('m1', 'What is the capital of France?'),
    templated('m2', 'Which planet is closest to the Sun?')
  ],
  val: [
    templated('m3', 'Who wrote the novel Beloved?'),
    templated('m4', 'What is the boiling point of water?')
  ]
};

test('the shared instruction header is not evidence of a near-duplicate', () => {
  assert.ok(HEADER.length > 120, `header is ${HEADER.length} chars`);
  const report = checkLeakage(TEMPLATED);
  assert.deepEqual(report.violations, [], 'four unrelated questions, one template');
  assert.ok(report.clean);
  assert.equal(report.nearDuplicateCheck.status, 'run');
});

test('a genuinely copied item is still caught behind the same template', () => {
  const leaked: Corpus = {
    ...TEMPLATED,
    val: [
      ...TEMPLATED.val,
      templated('m5', 'What is the capital city of France?')
    ]
  };
  const report = checkLeakage(leaked);
  assert.ok(!report.clean);
  const near = report.violations.filter((v) => v.startsWith('near-duplicate'));
  assert.equal(near.length, 1, report.violations.join(' | '));
  assert.match(near[0], /"m1" vs "m5"|"m5" vs "m1"/);
});

test('near-duplicates are still caught with no template to discount', () => {
  const plain: Corpus = {
    dev: [item('a1', 'sum the april transfers for the western region'), item('a2', 'unrelated question here')],
    val: [item('b1', 'sum the april transfers for the western regions'), item('b2', 'something else entirely')]
  };
  const report = checkLeakage(plain);
  const near = report.violations.filter((v) => v.startsWith('near-duplicate'));
  assert.equal(near.length, 1, report.violations.join(' | '));
  assert.match(near[0], /"a1" vs "b1"/);
});

test('the near-duplicate threshold is a parameter', () => {
  const pair: Corpus = {
    dev: [item('a1', 'sum the april transfers'), item('a2', 'a wholly different sentence')],
    val: [item('b1', 'sum the may transfers'), item('b2', 'yet another unrelated line')]
  };
  assert.ok(checkLeakage(pair).clean, 'april vs may is not a near-duplicate by default');
  const loose = checkLeakage(pair, { nearDuplicateThreshold: 0.3 });
  assert.ok(!loose.clean);
  assert.ok(loose.violations.some((v) => v.startsWith('near-duplicate')));
});

test('the violation list is capped instead of printing four million lines', () => {
  // 100 genuinely leaked pairs behind one shared filler sentence
  const key = (i: number) => `qx${String(i).padStart(3, '0')}zz`;
  const many: Corpus = {
    dev: Array.from({ length: 100 }, (_, i) => item(`d${i}`, `the standing instruction sentence, subject ${key(i)}`)),
    val: Array.from({ length: 100 }, (_, i) => item(`v${i}`, `the standing instruction sentence, subject ${key(i)}.`))
  };
  const uncapped = checkLeakage(many);
  assert.equal(uncapped.violationCount, 100, 'each pair is caught, none of the 9900 others');

  const report = checkLeakage(many, { maxViolations: 25 });
  assert.equal(report.violations.length, 26, 'the cap plus one summary line');
  assert.match(report.violations[25], /^\+75 more violations not listed$/);
  assert.equal(report.violationCount, 100);
  assert.ok(!report.clean);
});

test('an input repeated inside one split is a violation too', () => {
  const padded: Corpus = {
    val: [item('a', 'sum the april transfers'), item('b', 'Sum the  April transfers')]
  };
  const report = checkLeakage(padded);
  assert.ok(!report.clean, 'the same question twice inflates its own denominator');
  assert.match(report.violations[0], /duplicate input within split "val"/);
});
