/** The append-only ledger: results as a hash chain.
 *
 * Each JSONL entry commits to the one before it, so editing a past result,
 * deleting an inconvenient run, or reordering history breaks the chain
 * from that point on and verifyLedger() says exactly where. Appending is
 * the only honest operation the format supports. */

import { hashOf } from './canonical.ts';
import type { EvalRun } from './run.ts';

export interface LedgerEntry {
  seq: number;
  prev: string;
  body: EvalRun;
  entryHash: string;
}

const GENESIS = 'genesis';

export function appendRun(ledgerText: string, run: EvalRun): string {
  const lines = ledgerText.split('\n').filter((l) => l.trim().length > 0);
  const last = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]) as LedgerEntry) : null;
  const seq = (last?.seq ?? -1) + 1;
  const prev = last?.entryHash ?? GENESIS;
  const entry: LedgerEntry = { seq, prev, body: run, entryHash: hashOf({ seq, prev, body: run }) };
  return (lines.length > 0 ? lines.join('\n') + '\n' : '') + JSON.stringify(entry) + '\n';
}

export interface LedgerVerdict {
  intact: boolean;
  entries: number;
  brokenAt?: number;
  reason?: string;
}

export function verifyLedger(ledgerText: string): LedgerVerdict {
  const lines = ledgerText.split('\n').filter((l) => l.trim().length > 0);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let entry: LedgerEntry;
    try {
      entry = JSON.parse(lines[i]) as LedgerEntry;
    } catch {
      return { intact: false, entries: i, brokenAt: i, reason: 'unparseable entry' };
    }
    if (entry.seq !== i) {
      return { intact: false, entries: i, brokenAt: i, reason: `seq ${entry.seq} where ${i} expected (deletion or reorder)` };
    }
    if (entry.prev !== prev) {
      return { intact: false, entries: i, brokenAt: i, reason: 'chain link does not match the previous entry' };
    }
    if (hashOf({ seq: entry.seq, prev: entry.prev, body: entry.body }) !== entry.entryHash) {
      return { intact: false, entries: i, brokenAt: i, reason: 'entry body was edited after it was written' };
    }
    prev = entry.entryHash;
  }
  return { intact: true, entries: lines.length };
}
