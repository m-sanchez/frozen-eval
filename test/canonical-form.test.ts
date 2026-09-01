/** The family canonical byte form, held to a fixture shared with the other
 * packages that hash with it. The fixture file is a byte-identical copy: if
 * this repo's canonicalize disagrees with it, the same object hashes to two
 * different values in two tools that both claim to hash it the same way. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalize, hashOf } from '../src/canonical.ts';

interface AcceptCase {
  name: string;
  value: unknown;
  canonical: string;
  sha256: string;
}
interface RejectCase {
  name: string;
  kind: 'nonFinite' | 'unsafeInteger' | 'belowFloor' | 'unsupportedType';
  reason: string;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/canonical-form.fixture.json', import.meta.url), 'utf8')
) as { rule: string; accept: AcceptCase[]; reject: RejectCase[] };

/** JSON cannot carry NaN, Infinity, an unsafe integer, undefined or a
 * function, so the reject cases name a kind and the value is built here. */
const REJECT_VALUES: Record<string, unknown> = {
  NaN: NaN,
  Infinity: Infinity,
  '-Infinity': -Infinity,
  'unsafe integer': 9007199254740993,
  'tiny non-integer': 1e-7,
  'seven micro': 0.000007,
  'undefined at root': undefined,
  function: () => 1
};

test('canonical form: every accept case matches the shared fixture, text and hash', () => {
  assert.equal(fixture.accept.length, 27, 'fixture accept-case count');
  for (const c of fixture.accept) {
    assert.equal(canonicalize(c.value), c.canonical, `canonical text for "${c.name}"`);
    assert.equal(hashOf(c.value), c.sha256, `sha256 for "${c.name}"`);
    // the fixture's own hash is sha256 over the canonical text as UTF-8
    assert.equal(createHash('sha256').update(c.canonical, 'utf8').digest('hex'), c.sha256);
  }
});

test('canonical form: every reject case throws', () => {
  assert.equal(fixture.reject.length, 8, 'fixture reject-case count');
  for (const c of fixture.reject) {
    assert.ok(c.name in REJECT_VALUES, `reject case "${c.name}" has a constructed value`);
    assert.throws(() => canonicalize(REJECT_VALUES[c.name]), TypeError, `"${c.name}" (${c.kind})`);
  }
});

test('canonical form: the cases JSON cannot express', () => {
  // JSON has no -0 and no undefined property, so the fixture stores the
  // already-normalised value; the normalisation itself is asserted here.
  assert.equal(canonicalize(-0), '0');
  assert.equal(canonicalize({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
  assert.equal(canonicalize([-0, 0]), '[0,0]');
});
