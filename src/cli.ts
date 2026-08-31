#!/usr/bin/env node
/** frozen-eval CLI.
 *
 *   frozen-eval freeze <corpus.json> <bars.json> [--holdout a,b]
 *   frozen-eval verify <corpus.json> <manifest.json>
 *   frozen-eval check <corpus.json> [--allow-unchecked-near-duplicates]
 *   frozen-eval verify-ledger <runs.jsonl>
 *
 * Exit codes: 0 clean - 1 drift, violation, or broken chain - 2 usage error.
 * An unreadable file or a missing argument is a usage error, never a pass
 * and never confused with drift. */

import { readFileSync } from 'node:fs';
import { checkLeakage } from './leakage.ts';
import { verifyLedger } from './ledger.ts';
import { FrozenEvalError, freeze, verifyCorpus } from './manifest.ts';

const USAGE =
  'usage:\n' +
  '  frozen-eval freeze <corpus.json> <bars.json> [--holdout a,b]\n' +
  '  frozen-eval verify <corpus.json> <manifest.json>\n' +
  '  frozen-eval check <corpus.json> [--allow-unchecked-near-duplicates]\n' +
  '  frozen-eval verify-ledger <runs.jsonl>';

class UsageError extends Error {}

function requireArg(args: string[], index: number, name: string): string {
  const value = args[index];
  if (value == null || value.startsWith('--')) throw new UsageError(`missing ${name}`);
  return value;
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
        const corpus = readJson(requireArg(rest, 0, 'corpus path'), 'corpus');
        const bars = readJson(requireArg(rest, 1, 'bars path'), 'bars');
        const holdoutFlag = rest.indexOf('--holdout');
        const holdoutValue = holdoutFlag >= 0 ? rest[holdoutFlag + 1] : undefined;
        if (holdoutFlag >= 0 && (holdoutValue == null || holdoutValue.startsWith('--'))) {
          throw new UsageError('--holdout needs a comma-separated list of split names');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manifest = freeze(corpus as any, bars as any, {
          holdout: holdoutValue ? holdoutValue.split(',') : []
        });
        console.log(JSON.stringify(manifest, null, 2));
        return 0;
      }
      case 'verify': {
        const corpus = readJson(requireArg(rest, 0, 'corpus path'), 'corpus');
        const manifest = readJson(requireArg(rest, 1, 'manifest path'), 'manifest');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const problems = verifyCorpus(manifest as any, corpus as any);
        for (const p of problems) console.error(`drift: ${p}`);
        if (problems.length > 0) return 1;
        console.log('corpus matches the freeze');
        return 0;
      }
      case 'check': {
        const corpus = readJson(requireArg(rest, 0, 'corpus path'), 'corpus');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const report = checkLeakage(corpus as any, {
          allowUncheckedNearDuplicates: rest.includes('--allow-unchecked-near-duplicates')
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
        const verdict = verifyLedger(text);
        if (!verdict.intact) {
          console.error(`ledger broken at entry ${verdict.brokenAt}: ${verdict.reason}`);
          return 1;
        }
        console.log(`ledger intact: ${verdict.entries} run(s), chained`);
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

const invokedDirectly =
  process.argv[1] != null && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
