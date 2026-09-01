#!/usr/bin/env node
/** frozen-eval CLI.
 *
 *   frozen-eval freeze <corpus.json> <bars.json> [--holdout a,b]
 *   frozen-eval verify <corpus.json> <manifest.json>
 *   frozen-eval check <corpus.json> [--allow-unchecked-near-duplicates]
 *                                    [--near-dup-threshold 0.8] [--max-violations 100]
 *   frozen-eval verify-ledger <runs.jsonl> [--manifest m.json] [--corpus c.json]
 *
 * Exit codes: 0 clean - 1 drift, violation, or broken chain - 2 usage error.
 * An unreadable file or a missing argument is a usage error, never a pass
 * and never confused with drift. */

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkLeakage } from './leakage.ts';
import { verifyLedger } from './ledger.ts';
import { FrozenEvalError, freeze, verifyCorpus } from './manifest.ts';
import { parseBars, parseCorpus, parseManifest } from './parse.ts';

const USAGE =
  'usage:\n' +
  '  frozen-eval freeze <corpus.json> <bars.json> [--holdout a,b]\n' +
  '  frozen-eval verify <corpus.json> <manifest.json>\n' +
  '  frozen-eval check <corpus.json> [--allow-unchecked-near-duplicates]\n' +
  '                                  [--near-dup-threshold 0.8] [--max-violations 100]\n' +
  '  frozen-eval verify-ledger <runs.jsonl> [--manifest m.json] [--corpus c.json]';

class UsageError extends Error {}

function requireArg(args: string[], index: number, name: string): string {
  const value = args[index];
  if (value == null || value.startsWith('--')) throw new UsageError(`missing ${name}`);
  return value;
}

/** value of a `--flag value` pair, or undefined when the flag is absent. A
 * flag present with nothing after it is a usage error, not a default. */
function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value == null || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

/** `{ key: value }` for a numeric flag, or `{}` when it is absent, so the
 * option object never carries an explicit undefined over a default. */
function numberFlag<K extends string>(args: string[], flag: string, key: K): Partial<Record<K, number>> {
  const raw = flagValue(args, flag);
  if (raw == null) return {};
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new UsageError(`${flag} needs a number, got "${raw}"`);
  return { [key]: value } as Record<K, number>;
}

function readJson(path: string, name: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${name} at ${path}: ${err}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${name} at ${path} is not valid JSON: ${err}`);
  }
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'freeze': {
        const corpus = parseCorpus(readJson(requireArg(rest, 0, 'corpus path'), 'corpus'));
        const bars = parseBars(readJson(requireArg(rest, 1, 'bars path'), 'bars'));
        const holdoutFlag = rest.indexOf('--holdout');
        const holdoutValue = holdoutFlag >= 0 ? rest[holdoutFlag + 1] : undefined;
        if (holdoutFlag >= 0 && (holdoutValue == null || holdoutValue.startsWith('--'))) {
          throw new UsageError('--holdout needs a comma-separated list of split names');
        }
        const manifest = freeze(corpus, bars, {
          holdout: holdoutValue ? holdoutValue.split(',') : []
        });
        console.log(JSON.stringify(manifest, null, 2));
        return 0;
      }
      case 'verify': {
        const corpus = parseCorpus(readJson(requireArg(rest, 0, 'corpus path'), 'corpus'));
        const manifest = parseManifest(readJson(requireArg(rest, 1, 'manifest path'), 'manifest'));
        const problems = verifyCorpus(manifest, corpus);
        for (const p of problems) console.error(`drift: ${p}`);
        if (problems.length > 0) return 1;
        console.log('corpus matches the freeze');
        return 0;
      }
      case 'check': {
        const corpus = parseCorpus(readJson(requireArg(rest, 0, 'corpus path'), 'corpus'));
        const report = checkLeakage(corpus, {
          allowUncheckedNearDuplicates: rest.includes('--allow-unchecked-near-duplicates'),
          ...numberFlag(rest, '--near-dup-threshold', 'nearDuplicateThreshold'),
          ...numberFlag(rest, '--max-violations', 'maxViolations')
        });
        for (const v of report.violations) console.error(`leakage: ${v}`);
        if (report.nearDuplicateCheck.status === 'not-run') {
          console.error(
            `near-duplicate check not run (${report.nearDuplicateCheck.reason})` +
              (report.nearDuplicateCheck.overridden ? '; overridden by flag, recorded in the report' : '')
          );
        }
        if (!report.clean) return 1;
        console.log('no leakage found');
        return 0;
      }
      case 'verify-ledger': {
        const path = requireArg(rest, 0, 'ledger path');
        let text: string;
        try {
          text = readFileSync(path, 'utf8');
        } catch (err) {
          throw new UsageError(`cannot read ledger at ${path}: ${err}`);
        }
        const manifestPath = flagValue(rest, '--manifest');
        const corpusPath = flagValue(rest, '--corpus');
        if (corpusPath != null && manifestPath == null) {
          throw new UsageError('--corpus checks ids as part of replay, which needs --manifest');
        }
        const manifest = manifestPath != null ? parseManifest(readJson(manifestPath, 'manifest')) : undefined;
        const corpus = corpusPath != null ? parseCorpus(readJson(corpusPath, 'corpus')) : undefined;
        const verdict = verifyLedger(text, { manifest, corpus });
        if (!verdict.intact) {
          console.error(`ledger broken at entry ${verdict.brokenAt}: ${verdict.reason}`);
          return 1;
        }
        console.log(
          verdict.replayed
            ? `ledger verified: ${verdict.entries} run(s), chained and replayed`
            : `chain intact: ${verdict.entries} run(s) (not replayed; pass --manifest to verify results)`
        );
        return 0;
      }
      case '--help':
      case '-h':
      case 'help':
        console.log(USAGE);
        return 0;
      default:
        console.error(command ? `unknown command "${command}"` : 'no command given');
        console.error(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError || err instanceof FrozenEvalError) {
      console.error(`frozen-eval: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

/** Is this module the script node was asked to run? Comparing basenames -
 * which is what this did - made `.../node_modules/@m-sanchez/frozen-eval/
 * dist/cli.js` count as "invoked directly" for any consumer whose own entry
 * script is also named cli.js, so importing the library parsed the host's
 * argv and exited before the host's own code ran. Paths are compared
 * through realpath so an npm bin symlink still counts. */
export function isEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 == null) return false;
  try {
    return fileURLToPath(moduleUrl) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
