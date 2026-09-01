/** The append-only ledger: results as a hash chain.
 *
 * Each JSONL entry commits to the one before it, so editing a past result,
 * deleting an inconvenient run, or reordering history breaks the chain
 * from that point on and verifyLedger() says exactly where. Appending is
 * the only honest operation the format supports.
 *
 * The chain proves that nobody edited history after writing it. It does not
 * prove that any entry was ever true: an entry whose aggregate and verdict
 * were written to say whatever was wanted chains perfectly well. Replay is
 * the other half. Given the manifest the entries name, verifyLedger
 * recomputes each aggregate from the entry's own perItem scores and each
 * verdict from the manifest's own bars, and reports the first entry whose
 * arithmetic does not survive that. */

import { hashOf } from './canonical.ts';
import { FrozenEvalError } from './manifest.ts';
import type { Corpus, Manifest } from './manifest.ts';
import type { EvalRun } from './run.ts';
import { aggregate, evaluateBars } from './stats.ts';
import type { Aggregate } from './stats.ts';

export interface LedgerEntry {
  seq: number;
  prev: string;
  body: EvalRun;
  entryHash: string;
}

const GENESIS = 'genesis';

/** Append a run. Refuses to extend a chain that does not already verify:
 * building on top of a broken history hides where it broke. */
export function appendRun(ledgerText: string, run: EvalRun): string {
  const standing = verifyLedger(ledgerText);
  if (!standing.intact) {
    throw new FrozenEvalError(
      `refusing to append to a ledger that does not verify: entry ${standing.brokenAt}: ${standing.reason}`
    );
  }
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
  /** true when the entries' arithmetic was recomputed, not just the chain
   * walked. False means this verdict says nothing about whether the numbers
   * in the ledger are the numbers the scores support. */
  replayed: boolean;
  brokenAt?: number;
  reason?: string;
}

export interface VerifyLedgerOptions {
  /** the manifest the entries claim to have run against. Supplying it turns
   * chain-walking into replay. */
  manifest?: Manifest;
  /** the frozen corpus, so each entry's scored ids can be held to the ids
   * the split actually froze */
  corpus?: Corpus;
}

export function verifyLedger(ledgerText: string, opts: VerifyLedgerOptions = {}): LedgerVerdict {
  const lines = ledgerText.split('\n').filter((l) => l.trim().length > 0);
  const replayed = opts.manifest != null;
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    const broken = (reason: string): LedgerVerdict => ({
      intact: false,
      entries: i,
      replayed,
      brokenAt: i,
      reason
    });
    let entry: LedgerEntry;
    try {
      entry = JSON.parse(lines[i]) as LedgerEntry;
    } catch {
      return broken('unparseable entry');
    }
    if (entry.seq !== i) {
      return broken(`seq ${entry.seq} where ${i} expected (deletion or reorder)`);
    }
    if (entry.prev !== prev) {
      return broken('chain link does not match the previous entry');
    }
    if (hashOf({ seq: entry.seq, prev: entry.prev, body: entry.body }) !== entry.entryHash) {
      return broken('entry body was edited after it was written');
    }
    if (opts.manifest) {
      let reason: string | undefined;
      try {
        reason = replay(entry.body, opts.manifest, opts.corpus);
      } catch (err) {
        reason = `entry could not be replayed: ${(err as Error).message}`;
      }
      if (reason != null) return broken(reason);
    }
    prev = entry.entryHash;
  }
  return { intact: true, entries: lines.length, replayed };
}

/** Recompute an entry from what the entry itself carries. Returns the reason
 * it does not hold up, or undefined if it does. */
function replay(run: EvalRun, manifest: Manifest, corpus?: Corpus): string | undefined {
  const identity = run?.identity;
  if (identity == null) return 'entry has no identity';
  if (identity.manifestHash !== manifest.manifestHash) {
    return `entry names manifest ${identity.manifestHash}, the supplied manifest is ${manifest.manifestHash}`;
  }
  const perItem = run.perItem;
  if (!Array.isArray(perItem)) return 'entry has no perItem scores to replay';
  if (identity.itemCount !== perItem.length) {
    return `identity claims ${identity.itemCount} items, perItem carries ${perItem.length}`;
  }

  if (corpus) {
    const items = corpus[identity.split];
    if (!items) return `split "${identity.split}" is not in the supplied corpus`;
    const frozen = new Set(items.map((it) => it.id));
    const scored = new Set<string>();
    for (const p of perItem) {
      if (!frozen.has(p.id)) return `scored id "${p.id}" is not in the frozen split "${identity.split}"`;
      scored.add(p.id);
    }
    for (const id of frozen) {
      if (!scored.has(id)) return `frozen item "${id}" has no score in this entry`;
    }
  }

  let recomputed: Aggregate;
  try {
    recomputed = aggregate(
      perItem.map((p) => p.scores),
      identity.itemCount
    );
  } catch (err) {
    return `perItem scores do not aggregate: ${(err as Error).message}`;
  }
  if (hashOf(recomputed) !== hashOf(run.aggregate ?? {})) {
    return "the recorded aggregate is not the one this entry's own perItem scores produce";
  }
  const verdict = evaluateBars(recomputed, manifest.bars);
  if (hashOf(verdict) !== hashOf(run.verdict ?? {})) {
    return "the recorded verdict is not the one the manifest's bars produce over this aggregate";
  }
  return undefined;
}
