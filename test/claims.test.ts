/** README claims that are not about one module: the packaging promises and
 * the exact numbers the "Honest limits" section publishes. A number in a
 * README nobody executes is a number that quietly stops being true. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../src/canonical.ts';
import { wilson } from '../src/stats.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const readRepo = (name: string): string => readFileSync(join(REPO, name), 'utf8');
const pkg = JSON.parse(readRepo('package.json')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: { node?: string };
  version: string;
};

test('zero runtime dependencies, as the badge and the README both say', () => {
  assert.equal(pkg.dependencies, undefined, 'package.json declares runtime dependencies');
  assert.equal(pkg.peerDependencies, undefined);
  const lock = JSON.parse(readRepo('package-lock.json')) as {
    packages: Record<string, { dev?: boolean }>;
  };
  const production = Object.entries(lock.packages).filter(([path, meta]) => path !== '' && !meta.dev);
  assert.deepEqual(production, [], 'the lockfile carries a non-dev package');
});

test('the erasable-syntax badge is a compiler setting, not a promise', () => {
  const tsconfig = readRepo('tsconfig.json');
  assert.match(tsconfig, /"erasableSyntaxOnly": true/, 'npm run typecheck is what holds the badge up');
  const scripts = (JSON.parse(readRepo('package.json')) as { scripts: Record<string, string> }).scripts;
  assert.match(scripts.test, /node --test/, 'node runs the .ts sources directly');
  assert.match(scripts.typecheck, /tsc --noEmit/);
});

test('the README pins the version the package actually is', () => {
  const readme = readRepo('README.md');
  const pinned = readme.match(/github:m-sanchez\/frozen-eval#v([\d.]+)/);
  assert.ok(pinned, 'the README names an installable tag');
  assert.equal(pinned[1], pkg.version);
  assert.match(pkg.engines?.node ?? '', /22\.18/, 'the node floor the README quotes');
});

test('the canonical magnitude floor bites exactly where Honest limits says', () => {
  // "a run with exactly one success needs n < 10001 for the rate"
  assert.equal(canonicalize(1 / 10000), '0.0001');
  assert.throws(() => canonicalize(1 / 10001), TypeError);
  // "and n < 1766 for its Wilson lower bound (wilson(1, 1766).low = 0.00009996)"
  assert.doesNotThrow(() => canonicalize(wilson(1, 1765).low));
  assert.throws(() => canonicalize(wilson(1, 1766).low), TypeError);
  assert.equal(wilson(1, 1766).low.toFixed(8), '0.00009996');
  // "Zero successes is fine at any n: that bound is exactly 0"
  for (const n of [1, 3, 1766, 10001, 250000]) assert.equal(canonicalize(wilson(0, n).low), '0');
});

test('the README states the number of cases the exit-code contract actually runs', () => {
  const readme = readRepo('README.md');
  const stated = readme.match(/(\d+) cases covering\s*\n?\s*every documented code/);
  assert.ok(stated, 'the README states a case count');
  const run = spawnSync(
    process.execPath,
    [join(REPO, 'scripts', 'cli-contract.mjs'), join(REPO, 'src', 'index.ts'), process.execPath, join(REPO, 'src', 'cli.ts')],
    { encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const reported = run.stdout.match(/all (\d+) cases hold/);
  assert.ok(reported, run.stdout);
  assert.equal(reported[1], stated[1]);
});

test('every test CLAIMS.md names exists', () => {
  const declared = new Set<string>();
  for (const file of readdirSync(join(REPO, 'test')).filter((f) => f.endsWith('.test.ts'))) {
    const source = readFileSync(join(REPO, 'test', file), 'utf8');
    for (const m of source.matchAll(/^\s*test\((['"`])(.*?)\1/gm)) declared.add(`${file}::${m[2]}`);
  }
  const claims = readRepo('CLAIMS.md');
  const referenced = [...claims.matchAll(/`test\/([a-z-]+\.test\.ts)::(.*?)`/g)].map((m) => `${m[1]}::${m[2]}`);
  assert.ok(referenced.length > 40, `CLAIMS.md names only ${referenced.length} tests`);
  const dangling = referenced.filter((r) => !declared.has(r));
  assert.deepEqual(dangling, [], 'CLAIMS.md points at tests that do not exist');
});
