'use strict';

/**
 * rate-limit-line.js — formatRateLimitLine(merged, termWidth)
 *
 * Assembles the unified rate-limit Line 4 with 9-step graceful degradation.
 * Extracted from scripts/statusline.js v4.7.0 lines 643-703, then extended:
 *
 * v5.0 additions (spec.md FR-6, FR-8):
 *   - STALE freshness: appends dim `(stale Xh Ym)` suffix after last quota segment
 *   - UNAVAILABLE freshness: replaces ALL quota segments with a single dim hint message
 *     mapped from merged.hint_kind per FR-8 enum (5 strings + fallback)
 *
 * v4.7.0 behavior is byte-identical when merged.freshness === 'FRESH' (NFR-3 / US-4).
 *
 * Degradation chain (widest → narrowest):
 *  L0 full:   TTL:1h/99% | session:31%/42% +0.4/m ~3h43m | week:… | sonnet:22% | design:0% | PEAK
 *  L1 short labels
 *  L2 drop PEAK/OVERAGE
 *  L3 drop design
 *  L4 drop sonnet (opus always shown when present)
 *  L5 drop burn rates
 *  L6 drop reset times
 *  L7 drop pacing /NN%
 *  L8 minimum: s:31% | w:78%  (TTL dropped)
 *
 * Per spec.md FR-6/FR-8/NFR-3, plan.md §Key Algorithms, tasks.md T5.
 */

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

const { c } = require('../ansi');
const { buildTTLPrefix } = require('./ttl-prefix');
const { buildExtrasTail } = require('./extras-tail');

// ---------------------------------------------------------------------------
// FR-8 hint_kind → literal message map
// ---------------------------------------------------------------------------

/**
 * Map hint_kind enum values (from spec.md FR-8) to display literal strings.
 * Shown when merged.freshness === 'UNAVAILABLE'.
 */
const HINT_MESSAGES = {
  'no-auth':       '[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]',
  'auth-rejected': '[auth token rejected — refresh credentials]',
  'upstream-5xx':  '[API unreachable — service degraded]',
  'no-headers':    '[probe returned no ratelimit headers]',
  'no-model':      '[no compatible probe model in upstream — set CONTEXTBRICKS_QUOTA_PROBE_MODEL]',
};

/** Fallback message for unknown/absent hint_kind values */
const HINT_FALLBACK = '[quota unavailable]';

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape sequences and return visible character length.
 *
 * @param {string} str
 * @returns {number}
 */
function visibleLen(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Return 256-color ANSI code for a smooth green → yellow → red gradient.
 * 11 stops at ~10% intervals: green(46) → yellow(226) → red(196).
 *
 * @param {number} pct  — 0..100 (or 0..1 ratio × 100 from header)
 * @returns {string}
 */
function getColorForUtilization(pct) {
  const gradient = [46, 82, 118, 154, 190, 226, 220, 214, 208, 202, 196];
  const clamped = Math.max(0, Math.min(100, pct));
  const idx = Math.min(Math.round(clamped / 10), gradient.length - 1);
  return `\x1b[38;5;${gradient[idx]}m`;
}

/**
 * Format ISO reset time string to human-readable relative time.
 * exact=true: "1h30m", "2d5h"  |  exact=false: "1h", "2d"
 *
 * @param {string} isoStr
 * @param {boolean} exact
 * @returns {string}
 */
function formatResetTime(isoStr, exact) {
  if (!isoStr) return '';
  try {
    const resetMs = new Date(isoStr).getTime();
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0) return '0m';

    const totalMin = Math.floor(diffMs / 60000);
    const totalHours = Math.floor(totalMin / 60);
    const remainMin = totalMin % 60;
    const days = Math.floor(totalHours / 24);
    const remainHours = totalHours % 24;

    if (!exact) {
      if (totalMin < 60) return `${totalMin}m`;
      if (totalHours < 24) return `${totalHours}h`;
      return `${days}d`;
    }

    // Exact mode: combined units
    if (totalMin < 60) return `${totalMin}m`;
    if (totalHours < 24) {
      return remainMin > 0 ? `${totalHours}h${remainMin}m` : `${totalHours}h`;
    }
    return remainHours > 0 ? `${days}d${remainHours}h` : `${days}d`;
  } catch {
    return '';
  }
}

/**
 * Build a single rate-limit segment with pacing + burn + reset.
 * Extracted from statusline.js v4.7.0 lines 485-517 as a private helper.
 *
 * Examples:
 *   "session:31%/42% +0.4/m ~3h43m"  (full)
 *   "s:31%/42% +0.4/m ~3h43m"        (short labels)
 *   "session:31% ~3h43m"             (degraded: no pacing, no burn)
 *   "session:31%"                    (minimum)
 *
 * @param {{ utilization: number, resets_at: string, burn?: string, pacing?: number }} entry
 * @param {string} labelFull
 * @param {string} labelShort
 * @param {object} opts
 * @returns {string|null}
 */
function buildLimitSegment(entry, labelFull, labelShort, opts) {
  if (!entry || entry.utilization == null) return null;
  const {
    useShort = false,
    includePacing = true,
    includeBurn = true,
    includeReset = true,
    exact = true,
  } = opts || {};
  const label = useShort ? labelShort : labelFull;
  const pct = Number(entry.utilization);
  const rounded = Math.round(pct);
  const color = getColorForUtilization(pct);

  let segment = `${c.dimWhite}${label}:${c.reset}${color}${rounded}%${c.reset}`;

  if (includePacing && entry.pacing != null) {
    // Color pacing comparison: red if over-pace (>+5%), green if under (<-5%), dim otherwise.
    const diff = rounded - entry.pacing;
    let pColor = c.dim;
    if (diff > 5) pColor = c.redNorm;
    else if (diff < -5) pColor = c.greenNorm;
    segment += `${pColor}/${entry.pacing}%${c.reset}`;
  }
  if (includeBurn && entry.burn) {
    segment += ` ${c.dim}${entry.burn}${c.reset}`;
  }
  if (includeReset) {
    const resetStr = formatResetTime(entry.resets_at, exact);
    if (resetStr) segment += ` ${c.dim}~${resetStr}${c.reset}`;
  }
  return segment;
}

// ---------------------------------------------------------------------------
// Staleness suffix helpers (FR-6)
// ---------------------------------------------------------------------------

/**
 * Format age_ms into a human-readable staleness suffix.
 * Examples: 90 min → "1h30m", 45 min → "45m", 120 min → "2h"
 *
 * @param {number} age_ms
 * @returns {string}
 */
function formatStaleSuffix(age_ms) {
  if (!isFinite(age_ms) || age_ms < 0) return '';
  const totalMin = Math.floor(age_ms / 60000);
  const totalHours = Math.floor(totalMin / 60);
  const remainMin = totalMin % 60;

  if (totalHours === 0) return `${totalMin}m`;
  if (remainMin === 0) return `${totalHours}h`;
  return `${totalHours}h${remainMin}m`;
}

// ---------------------------------------------------------------------------
// formatRateLimitLine (exported)
// ---------------------------------------------------------------------------

/**
 * Assemble the unified rate-limit Line 4 with 9-step graceful degradation.
 *
 * When merged.freshness is absent or 'FRESH': v4.7.0 byte-identical behavior.
 * When merged.freshness === 'STALE': degradation chain + dim `(stale Xh Ym)` suffix.
 * When merged.freshness === 'UNAVAILABLE': skip quota segments, show dim hint message.
 *
 * @param {object} merged   — MergedView from buildRateView
 * @param {number} termWidth
 * @returns {string}
 */
function formatRateLimitLine(merged, termWidth) {
  if (!merged) return '';

  const exact = process.env.CONTEXTBRICKS_RESET_EXACT !== '0';
  const maxWidth = Math.max(20, termWidth || 80);
  const forceShort = (process.env.CONTEXTBRICKS_LABELS || '').toLowerCase() === 'short';

  // -------------------------------------------------------------------------
  // UNAVAILABLE path — skip all quota segments, show hint message (FR-8)
  // -------------------------------------------------------------------------
  if (merged.freshness === 'UNAVAILABLE') {
    const hintMsg = HINT_MESSAGES[merged.hint_kind] || HINT_FALLBACK;
    const ttl = buildTTLPrefix(merged.extras);
    if (ttl) {
      return `${ttl} | ${c.dim}${hintMsg}${c.reset}`;
    }
    return `${c.dim}${hintMsg}${c.reset}`;
  }

  // -------------------------------------------------------------------------
  // Inner build() — produces one candidate string for the degradation chain.
  // This is the byte-identical v4.7.0 build logic (except it now uses the
  // extracted buildTTLPrefix/buildExtrasTail helpers from separate modules).
  // -------------------------------------------------------------------------
  function build(opts) {
    const {
      useShort = false,
      includePacing = true,
      includeBurn = true,
      includeReset = true,
      includeSonnet = true,
      includeDesign = true,
      includeTTL = true,
      includePeak = true,
      includeOverage = true,
    } = opts;

    const segOpts = { useShort, includePacing, includeBurn, includeReset, exact };

    const segs = [
      buildLimitSegment(merged.session, 'session', 's', segOpts),
      buildLimitSegment(merged.week, 'week', 'w', segOpts),
    ];
    if (includeSonnet) {
      segs.push(buildLimitSegment(merged.sonnet, 'sonnet', 'son', { ...segOpts, includeBurn: false, includeReset: true }));
    }
    segs.push(buildLimitSegment(merged.opus, 'opus', 'opus', { ...segOpts, includeBurn: false, includeReset: true }));
    if (includeDesign) {
      segs.push(buildLimitSegment(merged.design, 'design', 'des', { ...segOpts, includeBurn: false, includeReset: false }));
    }
    const quotas = segs.filter(Boolean).join(' | ');
    if (!quotas) return '';

    const ttl = includeTTL ? buildTTLPrefix(merged.extras) : '';
    const tail = buildExtrasTail(merged.extras, { includePeak, includeOverage });
    return (ttl ? ttl + ' | ' : '') + quotas + tail;
  }

  // -------------------------------------------------------------------------
  // Degradation chain — sub-limits drop early, TTL survives until L8.
  // L0..L8 fallback table is byte-identical to v4.7.0.
  // -------------------------------------------------------------------------
  const baseShort = forceShort;
  const fallbacks = [
    { useShort: baseShort },                                                                                                                                      // L0 full
    { useShort: true },                                                                                                                                            // L1 short labels
    { useShort: true, includePeak: false, includeOverage: false },                                                                                                // L2 drop markers
    { useShort: true, includePeak: false, includeOverage: false, includeDesign: false },                                                                          // L3 drop design
    { useShort: true, includePeak: false, includeOverage: false, includeDesign: false, includeSonnet: false },                                                    // L4 drop sonnet
    { useShort: true, includePeak: false, includeOverage: false, includeDesign: false, includeSonnet: false, includePacing: false },                              // L5 drop pacing
    { useShort: true, includePeak: false, includeOverage: false, includeDesign: false, includeSonnet: false, includePacing: false, includeBurn: false },           // L6 drop burn
    { useShort: true, includePeak: false, includeOverage: false, includeDesign: false, includeSonnet: false, includePacing: false, includeBurn: false, includeReset: false }, // L7 drop reset
    { useShort: true, includePeak: false, includeOverage: false, includeDesign: false, includeSonnet: false, includePacing: false, includeBurn: false, includeReset: false, includeTTL: false }, // L8 minimum
  ];

  // -------------------------------------------------------------------------
  // STALE path — run degradation chain then append staleness suffix (FR-6)
  // -------------------------------------------------------------------------
  if (merged.freshness === 'STALE') {
    const ageLabel = formatStaleSuffix(merged.age_ms);
    const staleSuffix = ageLabel
      ? ` ${c.dim}(stale ${ageLabel})${c.reset}`
      : ` ${c.dim}(stale)${c.reset}`;

    let line = '';
    for (const opts of fallbacks) {
      line = build(opts);
      // Suffix is fixed-width display; account for its visible length in width check
      const suffixVisible = visibleLen(staleSuffix);
      if (line && visibleLen(line) + suffixVisible <= maxWidth) return line + staleSuffix;
      // If line is empty at this degradation level, keep trying (no quotas = nothing to suffix)
    }
    // Last resort: return whatever the minimum produces + suffix, regardless of width
    return line ? line + staleSuffix : '';
  }

  // -------------------------------------------------------------------------
  // FRESH (or absent freshness) path — v4.7.0 byte-identical degradation
  // -------------------------------------------------------------------------
  let line = '';
  for (const opts of fallbacks) {
    line = build(opts);
    if (visibleLen(line) <= maxWidth) return line;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { formatRateLimitLine };
