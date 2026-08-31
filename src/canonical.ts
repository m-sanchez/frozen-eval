/** Canonical bytes and hashing: object keys sorted, no insignificant
 * whitespace, SHA-256 hex, non-finite numbers refused. Every guarantee in
 * this package reduces to "these bytes have not changed", so the byte form
 * is specified here once and used everywhere. */

import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical form');
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`cannot canonicalize a ${typeof value}`);
  }
}

export const hashOf = (value: unknown): string =>
  createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
