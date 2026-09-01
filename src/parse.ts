/** Shape validation for the JSON the CLI is handed.
 *
 * Without it, `frozen-eval check package.json` threw `items.map is not a
 * function` and node exited 1 - the code the contract reserves for real
 * leakage, so a broken corpus-generation script read in CI as a leaky
 * corpus. Worse, `freeze` accepted `{"not":"a corpus"}` and printed a
 * manifest: split "not" with count 8, because a string has a length. A
 * freeze is the one artifact everything else is checked against; it must
 * refuse rubbish loudly rather than certify it. */

import { FrozenEvalError } from './manifest.ts';
import type { Bar, Corpus, Item, Manifest } from './manifest.ts';

export class InputShapeError extends FrozenEvalError {
  constructor(message: string) {
    super(message);
    this.name = 'InputShapeError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkItem(value: unknown, where: string): void {
  if (!isRecord(value)) throw new InputShapeError(`${where} is not an object`);
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new InputShapeError(`${where}.id is not a non-empty string`);
  }
  if (typeof value.input !== 'string') throw new InputShapeError(`${where}.input is not a string`);
  if (!('expected' in value)) {
    throw new InputShapeError(`${where}.expected is missing; use null if the judge does not need one`);
  }
}

export function parseCorpus(value: unknown, where = 'corpus'): Corpus {
  if (!isRecord(value)) throw new InputShapeError(`${where} is not an object of split name to items`);
  const splits = Object.entries(value);
  if (splits.length === 0) throw new InputShapeError(`${where} has no splits`);
  for (const [split, items] of splits) {
    if (!Array.isArray(items)) throw new InputShapeError(`${where}.${split} is not an array of items`);
    items.forEach((item, i) => checkItem(item, `${where}.${split}[${i}]`));
  }
  return value as unknown as Record<string, Item[]>;
}

export function parseBars(value: unknown, where = 'bars'): Bar[] {
  if (!Array.isArray(value)) throw new InputShapeError(`${where} is not an array`);
  value.forEach((bar, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(bar)) throw new InputShapeError(`${at} is not an object`);
    if (typeof bar.metric !== 'string' || bar.metric.length === 0) {
      throw new InputShapeError(`${at}.metric is not a non-empty string`);
    }
    if (bar.op !== '>=' && bar.op !== '<=') throw new InputShapeError(`${at}.op is not ">=" or "<="`);
    if (typeof bar.value !== 'number' || !Number.isFinite(bar.value)) {
      throw new InputShapeError(`${at}.value is not a finite number`);
    }
    if (bar.bound !== undefined && bar.bound !== 'point' && bar.bound !== 'wilson-low') {
      throw new InputShapeError(`${at}.bound is not "point" or "wilson-low"`);
    }
    if (bar.minCoverage !== undefined && typeof bar.minCoverage !== 'number') {
      throw new InputShapeError(`${at}.minCoverage is not a number`);
    }
    if (bar.note !== undefined && typeof bar.note !== 'string') {
      throw new InputShapeError(`${at}.note is not a string`);
    }
  });
  return value as Bar[];
}

export function parseManifest(value: unknown, where = 'manifest'): Manifest {
  if (!isRecord(value)) throw new InputShapeError(`${where} is not an object`);
  if (value.version !== 1) throw new InputShapeError(`${where}.version is not 1`);
  if (typeof value.manifestHash !== 'string') throw new InputShapeError(`${where}.manifestHash is not a string`);
  if (!isRecord(value.splits)) throw new InputShapeError(`${where}.splits is not an object`);
  for (const [name, meta] of Object.entries(value.splits)) {
    const at = `${where}.splits.${name}`;
    if (!isRecord(meta)) throw new InputShapeError(`${at} is not an object`);
    if (typeof meta.count !== 'number' || !Number.isInteger(meta.count)) {
      throw new InputShapeError(`${at}.count is not an integer`);
    }
    if (typeof meta.hash !== 'string') throw new InputShapeError(`${at}.hash is not a string`);
    if (typeof meta.holdout !== 'boolean') throw new InputShapeError(`${at}.holdout is not a boolean`);
  }
  parseBars(value.bars, `${where}.bars`);
  // returned as read, never rebuilt: dropping an unknown field would make a
  // manifest that should fail its own hash check quietly pass it
  return value as unknown as Manifest;
}
