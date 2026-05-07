'use strict';

/**
 * rate-view.js — buildRateView(quotaResult, cfExtras, nowMs)
 *
 * Builds the merged view object consumed by formatRateLimitLine.
 *
 * v5.0 change: first argument is now a QuotaResult (from quota-source.js)
 * rather than raw oauthData. The function maps quotaResult.data onto the
 * existing session/week/sonnet/opus/design/extra_usage shape and passes through
 * freshness, source_id, and hint_kind as new top-level fields.
 *
 * Output shape:
 *   {
 *     session:     { utilization, resets_at, burn, pacing } | null,
 *     week:        { utilization, resets_at, burn, pacing } | null,
 *     sonnet:      { utilization, resets_at, pacing } | null,
 *     opus:        { utilization, resets_at, pacing } | null,
 *     design:      { utilization, resets_at, pacing } | null,
 *     extras:      { ttl, hit, peak, overage },
 *     extra_usage: { usedCredits, monthlyLimit, enabled } | null,
 *     freshness:   'FRESH' | 'STALE' | 'UNAVAILABLE',
 *     source_id:   'hdr-probe' | 'cache-stale' | 'null',
 *     age_ms:      number,
 *     hint_kind:   string | undefined,
 *   }
 *
 * Per spec.md FR-6, FR-7, NFR-3, plan.md §Component Map, tasks.md T5.
 */

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

// ANSI constants imported for potential future formatting use (AC12).
// rate-view.js itself produces a plain data shape consumed by the format layer.
// eslint-disable-next-line no-unused-vars
const { c } = require('./ansi');

// Utility functions (private — not exported)
// These are extracted copies of the helpers from statusline.js v4.7.0.

const WINDOW_5H = 5 * 3600 * 1000;
const WINDOW_7D = 7 * 86400 * 1000;

/**
 * Compute pacing target (expected % used, based on elapsed time in window).
 * Returns integer 0..100, or null if resets_at is missing/invalid.
 *
 * @param {string} resetsAtIso
 * @param {number} windowMs
 * @param {number} nowMs
 * @returns {number|null}
 */
function computePacing(resetsAtIso, windowMs, nowMs) {
  if (!resetsAtIso || !windowMs) return null;
  const resetMs = new Date(resetsAtIso).getTime();
  if (!isFinite(resetMs) || resetMs <= 0) return null;
  const windowStart = resetMs - windowMs;
  const elapsed = nowMs - windowStart;
  if (elapsed <= 0) return 0;
  const pct = Math.floor((elapsed / windowMs) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Compute burn rate for a quota window. Pure — no Date.now() inside.
 * unit: 'm' (per minute, for 5h window) | 'hr' (per hour, for 7d window).
 *
 * @param {number} pct      — utilization percentage (0..100 scale, already converted from 0..1 header ratio)
 * @param {string} resetsAtIso
 * @param {number} windowMs
 * @param {number} nowMs
 * @param {'m'|'hr'} unit
 * @returns {string}
 */
function computeBurn(pct, resetsAtIso, windowMs, nowMs, unit) {
  if (pct <= 0) return '';
  const resetMs = new Date(resetsAtIso).getTime();
  if (!isFinite(resetMs)) return '';
  const windowStart = resetMs - windowMs;
  const elapsedMin = (nowMs - windowStart) / 60000;
  if (elapsedMin <= 1) return '';
  if (unit === 'hr') return `+${(pct / (elapsedMin / 60)).toFixed(1)}/hr`;
  return `+${(pct / elapsedMin).toFixed(1)}/m`;
}

// ---------------------------------------------------------------------------
// buildRateView
// ---------------------------------------------------------------------------

/**
 * Build the unified rate-limit view from a QuotaResult and optional cfExtras.
 *
 * @param {object} quotaResult  — QuotaResult from quota-source.js
 *   { data: QuotaData|null, freshness, age_ms, source_id, hint_kind? }
 * @param {object|null} cfExtras — cache-fix extras (TTL/hit/PEAK/OVERAGE), already staleness-gated
 * @param {number} nowMs         — current timestamp in ms (injected for testability)
 * @returns {object}             — MergedView (see module-level JSDoc)
 */
function buildRateView(quotaResult, cfExtras, nowMs) {
  const out = {
    session: null,
    week: null,
    sonnet: null,
    opus: null,
    design: null,
    extras: { ttl: null, hit: null, peak: false, overage: '' },
    extra_usage: null,
    // v5.0 additions — sourced from QuotaResult
    freshness: 'UNAVAILABLE',
    source_id: 'null',
    age_ms: Infinity,
    hint_kind: undefined,
  };

  // Pass-through freshness metadata
  if (quotaResult) {
    out.freshness = quotaResult.freshness || 'UNAVAILABLE';
    out.source_id = quotaResult.source_id || 'null';
    out.age_ms = typeof quotaResult.age_ms === 'number' ? quotaResult.age_ms : Infinity;
    if (quotaResult.hint_kind !== undefined) {
      out.hint_kind = quotaResult.hint_kind;
    }
  }

  // Map QuotaData fields onto canonical render fields
  const oauthData = quotaResult && quotaResult.data;

  if (oauthData) {
    // NOTE: QuotaData.utilization is a 0..1 ratio from the ratelimit headers.
    // The render layer (buildLimitSegment) expects 0..100 scale (percentage).
    // Convert here so the merged shape is byte-identical to v4.7.0 for equivalent inputs (NFR-3).
    if (oauthData.five_hour) {
      const fh = oauthData.five_hour;
      const util = fh.utilization * 100;
      out.session = {
        utilization: util,
        resets_at: fh.resets_at,
        burn: computeBurn(util, fh.resets_at, WINDOW_5H, nowMs, 'm'),
        pacing: computePacing(fh.resets_at, WINDOW_5H, nowMs),
      };
    }
    if (oauthData.seven_day) {
      const sd = oauthData.seven_day;
      const util = sd.utilization * 100;
      out.week = {
        utilization: util,
        resets_at: sd.resets_at,
        burn: computeBurn(util, sd.resets_at, WINDOW_7D, nowMs, 'hr'),
        pacing: computePacing(sd.resets_at, WINDOW_7D, nowMs),
      };
    }
    if (oauthData.seven_day_sonnet) {
      const s = oauthData.seven_day_sonnet;
      out.sonnet = { utilization: s.utilization * 100, resets_at: s.resets_at, pacing: computePacing(s.resets_at, WINDOW_7D, nowMs) };
    }
    if (oauthData.seven_day_opus) {
      const o = oauthData.seven_day_opus;
      out.opus = { utilization: o.utilization * 100, resets_at: o.resets_at, pacing: computePacing(o.resets_at, WINDOW_7D, nowMs) };
    }
    // Claude Design (seven_day_omelette): skip entries without a real reset timestamp
    if (oauthData.seven_day_omelette && oauthData.seven_day_omelette.resets_at) {
      const d = oauthData.seven_day_omelette;
      out.design = { utilization: d.utilization * 100, resets_at: d.resets_at, pacing: computePacing(d.resets_at, WINDOW_7D, nowMs) };
    }
    // Extra usage (monetary overage) — monthlyLimit is in cents
    if (oauthData.extra_usage) {
      const eu = oauthData.extra_usage;
      out.extra_usage = {
        usedCredits: Number(eu.used_credits) || 0,
        monthlyLimit: Number(eu.monthly_limit) || 0,
        enabled: Boolean(eu.is_enabled),
      };
    }
    // Unknown buckets in quotaResult.data.quotas pass through verbatim —
    // they are preserved on the source data and not rendered as canonical fields (C3).
  }

  // cfExtras: TTL/hit/PEAK/OVERAGE only — already staleness-gated and normalized
  // by readCacheFixExtras → gateAndNormalize. No re-normalization here. (FR-7)
  if (cfExtras) {
    out.extras.ttl = cfExtras.ttl_tier;
    out.extras.hit = cfExtras.hit_rate;
    out.extras.peak = cfExtras.peak_hour;
    out.extras.overage = cfExtras.overage;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { buildRateView };
