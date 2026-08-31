/** frozen-eval CLI. Run with: node --experimental-strip-types bin/frozen-eval.ts
 *
 *   freeze <corpus.json> <bars.json> [--holdout a,b]   write manifest.json to stdout
 *   verify <corpus.json> <manifest.json>               exit 1 on drift
 *   check <corpus.json>                                leakage; exit 1 on violations
 *   verify-ledger <runs.jsonl>                         exit 1 on a broken chain
 */

import { readFileSync } from 'node:fs';
import { checkLeakage } from '../src/leakage.ts';
import { verifyLedger } from '../src/ledger.ts';
import { freeze, verifyCorpus } from '../src/manifest.ts';

const [command, ...rest] = process.argv.slice(2);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

switch (command) {
  case 'freeze': {
    const holdoutFlag = rest.indexOf('--holdout');
    const holdout = holdoutFlag >= 0 ? rest[holdoutFlag + 1].split(',') : [];
    const manifest = freeze(readJson(rest[0]), readJson(rest[1]), { holdout });
    console.log(JSON.stringify(manifest, null, 2));
    break;
  }
  case 'verify': {
    const problems = verifyCorpus(readJson(rest[1]), readJson(rest[0]));
    for (const p of problems) console.error(`drift: ${p}`);
    if (problems.length > 0) process.exit(1);
    console.log('corpus matches the freeze');
    break;
  }
  case 'check': {
    const report = checkLeakage(readJson(rest[0]));
    for (const v of report.violations) console.error(`leakage: ${v}`);
    if (!report.clean) process.exit(1);
    console.log('no leakage found');
    break;
  }
  case 'verify-ledger': {
    const verdict = verifyLedger(readFileSync(rest[0], 'utf8'));
    if (!verdict.intact) {
      console.error(`ledger broken at entry ${verdict.brokenAt}: ${verdict.reason}`);
      process.exit(1);
    }
    console.log(`ledger intact: ${verdict.entries} run(s), chained`);
    break;
  }
  default:
    console.error('usage: frozen-eval freeze|verify|check|verify-ledger ...');
    process.exit(2);
}
