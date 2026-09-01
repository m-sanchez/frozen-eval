#!/usr/bin/env node
/** The CLI's documented exit-code contract, asserted against a real
 * invocation of the binary.
 *
 *   node scripts/cli-contract.mjs <library-entry> <cli> [cli args...]
 *   node scripts/cli-contract.mjs ./src/index.ts node ./src/cli.ts
 *   node scripts/cli-contract.mjs "$S/node_modules/@m-sanchez/frozen-eval/dist/index.js" \
 *                                 "$S/node_modules/.bin/frozen-eval"
 *
 * Exit codes are the entire integration contract for a CI tool: 0 clean,
 * 1 drift or violation or broken chain, 2 usage error. Run against the
 * INSTALLED binary this also proves the packed tarball is executable and
 * that importing the library does not end the host process. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const [libraryArg, ...cli] = process.argv.slice(2);
const library = libraryArg ?? join(repo, 'src', 'index.ts');
if (cli.length === 0) cli.push(process.execPath, join(repo, 'src', 'cli.ts'));

const { appendRun, runEval } = await import(pathToFileURL(library).href);

const dir = mkdtempSync(join(tmpdir(), 'frozen-eval-contract-'));
const at = (name) => join(dir, name);
const write = (name, text) => (writeFileSync(at(name), text), at(name));
const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2));

const corpus = JSON.parse(readFileSync(join(repo, 'example', 'corpus.json'), 'utf8'));
const corpusPath = writeJson('corpus.json', corpus);
const barsPath = writeJson('bars.json', JSON.parse(readFileSync(join(repo, 'example', 'bars.json'), 'utf8')));

const drifted = structuredClone(corpus);
drifted.dev[0].input += ' (reworded after the freeze)';
const driftedPath = writeJson('drifted.json', drifted);

const leaky = structuredClone(corpus);
leaky.val[0] = { ...leaky.val[0], id: 'd1' }; // the same id in two splits
const leakyPath = writeJson('leaky.json', leaky);

const wrongShapePath = writeJson('wrong.json', { not: 'a corpus' });
const emptyLedgerPath = write('empty.jsonl', '');
const brokenLedgerPath = write(
  'broken.jsonl',
  JSON.stringify({ seq: 1, prev: 'genesis', body: {}, entryHash: 'nope' }) + '\n'
);

let failures = 0;
const run = (args) => spawnSync(cli[0], [...cli.slice(1), ...args], { encoding: 'utf8' });
const expect = (code, args, why) => {
  const r = run(args);
  const ok = r.status === code;
  if (!ok) failures++;
  const shown = args.map((a) => (a.startsWith(dir) ? a.slice(dir.length + 1) : a)).join(' ');
  console.log(`${ok ? 'ok  ' : 'FAIL'} exit ${r.status} (want ${code})  ${shown}  - ${why}`);
  if (!ok) console.log(`     stdout: ${r.stdout.trim()}\n     stderr: ${r.stderr.trim()}`);
  return r;
};

// --- 2: usage errors, which must never read as a pass or as drift ---
expect(2, [], 'no command');
expect(2, ['nonsense'], 'unknown command');
expect(2, ['freeze'], 'missing corpus path');
expect(2, ['verify', at('no-such.json'), at('also-none.json')], 'unreadable file');
expect(2, ['check', wrongShapePath], 'valid JSON, wrong shape');
expect(2, ['freeze', wrongShapePath, barsPath], 'a freeze must refuse rubbish, not certify it');
expect(2, ['verify', corpusPath, wrongShapePath], 'manifest of the wrong shape');
expect(2, ['check', corpusPath, '--near-dup-threshold'], 'a flag with no value');

// --- 0: the clean path ---
expect(0, ['--help'], 'help');
const frozen = expect(0, ['freeze', corpusPath, barsPath, '--holdout', 'holdout'], 'freeze');
const manifestPath = write('manifest.json', frozen.stdout);
const manifest = JSON.parse(frozen.stdout);
expect(0, ['verify', corpusPath, manifestPath], 'the corpus still matches the freeze');
expect(0, ['check', corpusPath], 'a clean corpus');
expect(0, ['verify-ledger', emptyLedgerPath], 'an empty ledger is a chain of nothing');

// --- 1: drift, violation, broken chain ---
expect(1, ['verify', driftedPath, manifestPath], 'a drifted split');
expect(1, ['check', leakyPath], 'a duplicated id across splits');
expect(1, ['verify-ledger', brokenLedgerPath], 'a chain that starts at seq 1');

// --- ledgers built with the library, verified through the binary ---
const honest = await runEval({
  manifest,
  corpus,
  split: 'dev',
  judge: (item) => ({ exact: item.id !== 'd4', latencyMs: 12 }),
  label: 'contract'
});
const ledgerPath = write('runs.jsonl', appendRun('', honest));
expect(0, ['verify-ledger', ledgerPath], 'an honest chain');
expect(0, ['verify-ledger', ledgerPath, '--manifest', manifestPath], 'and it replays');
expect(0, ['verify-ledger', ledgerPath, '--manifest', manifestPath, '--corpus', corpusPath], 'ids too');
expect(2, ['verify-ledger', ledgerPath, '--corpus', corpusPath], '--corpus without --manifest');
expect(2, ['verify-ledger', ledgerPath, '--manifest', at('no-such.json')], 'unreadable manifest');

const fabricated = structuredClone(honest);
fabricated.aggregate.exact = { kind: 'rate', value: 1, n: 4, expected: 4, wilson: { low: 1, high: 1 } };
fabricated.verdict.pass = true;
for (const result of fabricated.verdict.results) result.pass = true;
const fabricatedPath = write('fabricated.jsonl', appendRun('', fabricated));
expect(0, ['verify-ledger', fabricatedPath], 'the fabricated entry chains cleanly');
expect(1, ['verify-ledger', fabricatedPath, '--manifest', manifestPath], 'and fails replay');

// --- importing the library must not end the host process ---
for (const name of ['cli.js', 'cli.ts', 'index.js']) {
  writeFileSync(at('package.json'), JSON.stringify({ type: 'module' }));
  const host = write(
    name,
    `import { freeze } from ${JSON.stringify(pathToFileURL(library).href)};\n` +
      `if (typeof freeze !== 'function') throw new Error('the package did not export freeze');\n` +
      `console.log('HOST REACHED ITS OWN LAST LINE');\n`
  );
  const r = spawnSync(process.execPath, [host, 'freeze', 'nope.json'], { encoding: 'utf8' });
  const ok = r.status === 0 && r.stdout.includes('HOST REACHED ITS OWN LAST LINE');
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} a host script named ${name} imports the library and keeps running`);
  if (!ok) console.log(`     status ${r.status}\n     stdout: ${r.stdout.trim()}\n     stderr: ${r.stderr.trim()}`);
}

console.log(failures === 0 ? 'cli contract: all cases hold' : `cli contract: ${failures} case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
