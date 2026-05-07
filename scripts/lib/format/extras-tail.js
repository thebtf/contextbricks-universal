'use strict';

/**
 * extras-tail.js — buildExtrasTail(extras, flags)
 *
 * Extracted 1:1 from scripts/statusline.js v4.7.0 lines 617-628.
 * Builds the cache-fix extras tail ("| PEAK | OVERAGE").
 * TTL is rendered as a prefix by buildTTLPrefix, not here.
 *
 * Per spec.md FR-7, NFR-3, plan.md §Component Map, tasks.md T5.
 */

/**
 * Build the extras tail segment.
 *
 * @param {{ ttl: string|null, hit: number|null, peak: boolean, overage: string }} extras
 * @param {{ includePeak?: boolean, includeOverage?: boolean }} flags
 * @returns {string}
 */
function buildExtrasTail(extras, flags) {
  if (!extras) return '';
  const { includePeak = true, includeOverage = true } = flags || {};
  let tail = '';
  if (extras.overage === 'active' && includeOverage) {
    tail += ' | OVERAGE';
  }
  if (extras.peak && includePeak) {
    tail += ` | \x1b[33mPEAK\x1b[0m`;
  }
  return tail;
}

module.exports = { buildExtrasTail };
