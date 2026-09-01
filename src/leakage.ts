/** Leakage checks: the quiet ways a corpus flatters a model. Duplicate
 * ids, the same input frozen into two splits, and near-duplicates across
 * splits (character-trigram Dice). Violations are for exiting non-zero
 * over, not for reading and moving on.
 *
 * The near-duplicate measure is IDF-weighted. Almost every eval corpus is
 * prompt-templated, and plain Dice over the whole input reads the shared
 * instruction header as evidence of duplication: four unrelated MCQ
 * questions behind one 142-character header scored 0.83-0.89 against each
 * other, so every cross-split pair was flagged and `check` could not exit 0
 * at all. Weighting each trigram by how rare it is across the corpus makes
 * boilerplate contribute almost nothing and leaves the item's own words
 * carrying the similarity. */

import type { Corpus } from './manifest.ts';

export interface LeakageReport {
  clean: boolean;
  /** at most `maxViolations` entries, plus a final "+N more" line when the
   * cap bit; `violationCount` is always the true total */
  violations: string[];
  violationCount: number;
  nearDuplicateCheck: {
    status: 'run' | 'not-run';
    reason?: string;
    /** true when not-run was explicitly overridden by the caller; the
     * override travels with the report so a ledger can record it */
    overridden?: boolean;
    /** the threshold the check actually ran at, so a report read later says
     * what was asked of it rather than what the default happens to be now */
    threshold?: number;
  };
}

export interface LeakageOptions {
  /** pair-wise near-dup checking is O(n^2); above this many items it is
   * refused rather than silently attempted or silently skipped */
  maxExhaustiveItems?: number;
  /** proceed WITHOUT the near-duplicate check; the report records the
   * override. Unknown never becomes pass by default. */
  allowUncheckedNearDuplicates?: boolean;
  /** IDF-weighted Dice at or above which a cross-split pair is a
   * near-duplicate (default 0.8). Lower catches paraphrase and costs false
   * positives; higher catches only close copies. */
  nearDuplicateThreshold?: number;
  /** cap on how many violation strings are built and returned (default 100).
   * The O(n^2) loop can otherwise produce millions of them, which is the
   * slowest and least readable way to say "this corpus is broken". */
  maxViolations?: number;
}

const NEAR_DUP_THRESHOLD = 0.8;
const DEFAULT_EXHAUSTIVE_CEILING = 5000;
const DEFAULT_MAX_VIOLATIONS = 100;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function trigrams(text: string): Set<string> {
  const s = normalize(text);
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) grams.add(s.slice(i, i + 3));
  return grams;
}

/** How much one trigram counts, given how many of the corpus's items
 * contain it. A gram in every item weighs log((N+1)/N) - near zero next to
 * log(N+1) for a gram in one item - so boilerplate cannot carry a pair over
 * the threshold on its own. The +1 keeps the weight positive at df = N, so
 * a two-item corpus (where every shared gram is "boilerplate") still
 * discriminates instead of collapsing to zero. */
function idf(documentCount: number, df: number): number {
  return Math.log((documentCount + 1) / df);
}

/** Trigrams are interned to small integers once, so the pair loop is
 * typed-array arithmetic rather than millions of string hashes. At the
 * documented 5000-item ceiling that is the difference between seconds and
 * a minute. */
interface Interned {
  ids: Int32Array[];
  weight: Float64Array;
  sums: Float64Array;
}

function intern(grams: Set<string>[], documentCount: number): Interned {
  const gramId = new Map<string, number>();
  const ids = grams.map((set) => {
    const arr = new Int32Array(set.size);
    let k = 0;
    for (const g of set) {
      let id = gramId.get(g);
      if (id === undefined) {
        id = gramId.size;
        gramId.set(g, id);
      }
      arr[k++] = id;
    }
    return arr;
  });
  const df = new Int32Array(gramId.size);
  for (const arr of ids) for (let k = 0; k < arr.length; k++) df[arr[k]]++;
  const weight = new Float64Array(gramId.size);
  for (let g = 0; g < weight.length; g++) weight[g] = idf(documentCount, df[g]);
  const sums = new Float64Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    let sum = 0;
    const arr = ids[i];
    for (let k = 0; k < arr.length; k++) sum += weight[arr[k]];
    sums[i] = sum;
  }
  return { ids, weight, sums };
}

export function checkLeakage(corpus: Corpus, opts: LeakageOptions = {}): LeakageReport {
  const violations: string[] = [];
  let violationCount = 0;
  const maxViolations = opts.maxViolations ?? DEFAULT_MAX_VIOLATIONS;
  const record = (v: () => string): void => {
    violationCount++;
    if (violations.length < maxViolations) violations.push(v());
  };

  const flat = Object.entries(corpus).flatMap(([split, items]) =>
    items.map((item) => ({ split, item }))
  );
  const ceiling = opts.maxExhaustiveItems ?? DEFAULT_EXHAUSTIVE_CEILING;
  const threshold = opts.nearDuplicateThreshold ?? NEAR_DUP_THRESHOLD;

  const seenIds = new Map<string, string>();
  for (const { split, item } of flat) {
    const already = seenIds.get(item.id);
    if (already) record(() => `duplicate id "${item.id}" in ${already} and ${split}`);
    else seenIds.set(item.id, split);
  }

  const byInput = new Map<string, string>();
  for (const { split, item } of flat) {
    const key = normalize(item.input);
    const already = byInput.get(key);
    if (already === undefined) {
      byInput.set(key, split);
    } else if (already !== split) {
      record(() => `identical input in ${already} and ${split}: "${item.input.slice(0, 60)}"`);
    } else {
      // Twice in one split is not cross-split leakage, but it doubles the
      // item's weight in the rate and tightens the Wilson interval a
      // bound:'wilson-low' bar binds. A denominator inflated by a copy is
      // not the denominator the freeze claims.
      record(() => `duplicate input within split "${split}": "${item.input.slice(0, 60)}"`);
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
      record(() => `near-duplicate check not run: ${reason}; unknown is not clean`);
    }
  } else {
    const withGrams = flat.map((f) => trigrams(f.item.input));
    const { ids, weight, sums } = intern(withGrams, flat.length);
    // `mark[g] === i + 1` means gram g belongs to item i; one pass per outer
    // item replaces a membership test per gram per pair.
    const mark = new Int32Array(weight.length);
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i];
      const ai = ids[i];
      for (let k = 0; k < ai.length; k++) mark[ai[k]] = i + 1;
      for (let j = i + 1; j < flat.length; j++) {
        const b = flat[j];
        if (a.split === b.split) continue;
        if (a.item.input === b.item.input) continue; // already an identical-input violation
        const total = sums[i] + sums[j];
        if (total <= 0) continue;
        // shared weight can never exceed the smaller side's total, so a pair
        // that cannot reach the threshold is skipped before touching a gram
        if (2 * Math.min(sums[i], sums[j]) < threshold * total) continue;
        const bj = ids[j];
        let shared = 0;
        for (let k = 0; k < bj.length; k++) {
          const g = bj[k];
          if (mark[g] === i + 1) shared += weight[g];
        }
        const similarity = (2 * shared) / total;
        if (similarity >= threshold) {
          record(
            () =>
              `near-duplicate across ${a.split}/${b.split} (dice ${similarity.toFixed(2)}): "${a.item.id}" vs "${b.item.id}"`
          );
        }
      }
    }
    nearDuplicateCheck = { status: 'run', threshold };
  }

  if (violationCount > violations.length) {
    violations.push(`+${violationCount - violations.length} more violations not listed`);
  }
  return { clean: violationCount === 0, violations, violationCount, nearDuplicateCheck };
}
