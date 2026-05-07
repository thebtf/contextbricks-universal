'use strict';

/**
 * ttl-prefix.js — buildTTLPrefix(extras)
 *
 * Extracted 1:1 from scripts/statusline.js v4.7.0 lines 606-613.
 * Builds TTL+hit% prefix segment for Line 4 ("TTL:1h/99%").
 * TTL and hit% are an atomic pair — both shown or both hidden.
 *
 * Per spec.md FR-7, NFR-3, plan.md §Component Map, tasks.md T5.
 */

const { c } = require('../ansi');

/**
 * Build TTL+hit% prefix segment for Line 4.
 *
 * @param {{ ttl: string|null, hit: number|null, peak: boolean, overage: string }} extras
 * @returns {string}  — ANSI-formatted prefix string, empty when no TTL
 */
function buildTTLPrefix(extras) {
  if (!extras || !extras.ttl) return '';
  const hitSuffix = (extras.hit != null) ? `${c.dim}/${extras.hit}%${c.reset}` : '';
  if (extras.ttl === '5m') {
    return `\x1b[31mTTL:5m${hitSuffix}\x1b[0m`;
  }
  return `${c.dimWhite}TTL:${c.reset}${extras.ttl}${hitSuffix}`;
}

module.exports = { buildTTLPrefix };
