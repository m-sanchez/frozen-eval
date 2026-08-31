/** Leakage checks: the quiet ways a corpus flatters a model. Duplicate
 * ids, the same input frozen into two splits, and near-duplicates across
 * splits (character-trigram Dice). Violations are for exiting non-zero
 * over, not for reading and moving on. */

import type { Corpus } from './manifest.ts';

export interface LeakageReport {
  clean: boolean;
  violations: string[];
  nearDuplicateCheck: {
    status: 'run' | 'not-run';
    reason?: string;
    /** true when not-run was explicitly overridden by the caller; the
     * override travels with the report so a ledger can record it */
    overridden?: boolean;
  };
}

export interface LeakageOptions {
  /** pair-wise near-dup checking is O(n^2); above this many items it is
   * refused rather than silently attempted or silently skipped */
  maxExhaustiveItems?: number;
  /** proceed WITHOUT the near-duplicate check; the report records the
   * override. Unknown never becomes pass by default. */
  allowUncheckedNearDuplicates?: boolean;
}

const NEAR_DUP_THRESHOLD = 0.8;
const DEFAULT_EXHAUSTIVE_CEILING = 5000;

function trigrams(text: string): Set<string> {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) grams.add(s.slice(i, i + 3));
  return grams;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export function checkLeakage(corpus: Corpus, opts: LeakageOptions = {}): LeakageReport {
  const violations: string[] = [];
  const flat = Object.entries(corpus).flatMap(([split, items]) =>
    items.map((item) => ({ split, item }))
  );
  const ceiling = opts.maxExhaustiveItems ?? DEFAULT_EXHAUSTIVE_CEILING;

  const seenIds = new Map<string, string>();
  for (const { split, item } of flat) {
    const already = seenIds.get(item.id);
    if (already) violations.push(`duplicate id "${item.id}" in ${already} and ${split}`);
    else seenIds.set(item.id, split);
  }

  const byInput = new Map<string, string>();
  for (const { split, item } of flat) {
    const key = item.input.toLowerCase().replace(/\s+/g, ' ').trim();
    const already = byInput.get(key);
    if (already && already !== split) {
      violations.push(`identical input in ${already} and ${split}: "${item.input.slice(0, 60)}"`);
    } else if (!already) {
      byInput.set(key, split);
    }
  }

  let nearDuplicateCheck: LeakageReport['nearDuplicateCheck'];
  if (flat.length > ceiling) {
    const reason = `corpus has ${flat.length} items, above the exhaustive-check ceiling of ${ceiling}`;
    if (opts.allowUncheckedNearDuplicates) {
      nearDuplicateCheck = { status: 'not-run', reason, overridden: true };
    } else {
      // A check that could not run is not a check that passed.
      nearDuplicateCheck = { status: 'not-run', reason };
      violations.push(`near-duplicate check not run: ${reason}; unknown is not clean`);
    }
  } else {
    const withGrams = flat.map((f) => ({ ...f, grams: trigrams(f.item.input) }));
    for (let i = 0; i < withGrams.length; i++) {
      for (let j = i + 1; j < withGrams.length; j++) {
        const a = withGrams[i];
        const b = withGrams[j];
        if (a.split === b.split) continue;
        const similarity = dice(a.grams, b.grams);
        if (similarity >= NEAR_DUP_THRESHOLD && a.item.input !== b.item.input) {
          violations.push(
            `near-duplicate across ${a.split}/${b.split} (dice ${similarity.toFixed(2)}): "${a.item.id}" vs "${b.item.id}"`
          );
        }
      }
    }
    nearDuplicateCheck = { status: 'run' };
  }

  return { clean: violations.length === 0, violations, nearDuplicateCheck };
}
