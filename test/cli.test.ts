/** The CLI's exit codes are the whole integration contract for a CI tool,
 * and importing a library must never end the host process. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint, main } from '../src/cli.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const INDEX = join(REPO, 'src', 'index.ts');
const CLI = join(REPO, 'src', 'cli.ts');

const scratch = (): string => mkdtempSync(join(tmpdir(), 'frozen-eval-'));

test('the entrypoint guard compares paths, not basenames', () => {
  // the exact shape that killed a consumer: an installed dist/cli.js and a
  // host whose own entry script is also called cli.js
  assert.equal(
    isEntrypoint('file:///home/app/node_modules/@m-sanchez/frozen-eval/dist/cli.js', '/home/app/cli.js'),
    false
  );
  assert.equal(isEntrypoint(pathToFileURL(CLI).href, CLI), true, 'the real binary still runs');
  assert.equal(isEntrypoint(pathToFileURL(CLI).href, undefined), false);
  assert.equal(isEntrypoint(pathToFileURL(CLI).href, join(REPO, 'no-such-file.js')), false);
});

for (const name of ['cli.js', 'cli.ts']) {
  test(`importing the library from a script named ${name} reaches the host's own last line`, () => {
    const dir = scratch();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
      join(dir, name),
      `import { freeze } from ${JSON.stringify(pathToFileURL(INDEX).href)};\n` +
        `if (typeof freeze !== 'function') throw new Error('not imported');\n` +
        `console.log('HOST REACHED ITS OWN LAST LINE');\n`
    );
    const run = spawnSync(process.execPath, [join(dir, name), 'freeze', 'nope.json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /HOST REACHED ITS OWN LAST LINE/);
  });
}

test('a valid-JSON file of the wrong shape is a usage error, not drift', () => {
  const dir = scratch();
  const wrong = join(dir, 'wrong.json');
  writeFileSync(wrong, JSON.stringify({ not: 'a corpus' }));
  const manifest = join(dir, 'also-wrong.json');
  writeFileSync(manifest, JSON.stringify([1, 2, 3]));
  assert.equal(main(['check', wrong]), 2, 'check');
  assert.equal(main(['verify', wrong, manifest]), 2, 'verify');
  assert.equal(main(['freeze', wrong, manifest]), 2, 'freeze');
});

test('the documented exit codes hold against the CLI', () => {
  const contract = join(REPO, 'scripts', 'cli-contract.mjs');
  const run = spawnSync(process.execPath, [contract, INDEX, process.execPath, CLI], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
