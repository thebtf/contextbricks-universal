'use strict';

/**
 * parseRateLimitHeaders — HTTP response headers → QuotaData shape
 *
 * Captures every header matching /^anthropic-ratelimit-unified-(.+)-utilization$/i,
 * pairs each with its sibling *-reset and *-status headers, maps known bucket names
 * to canonical field names, and preserves unknown buckets under quotas[<name>].
 *
 * Per spec FR-2, plan §Key Algorithms, and clarification C3 (pass-through-unknown).
 *
 * @param {Object<string, string>} headers — HTTP response headers (any case)
 * @returns {Object} QuotaData shape
 */
function parseRateLimitHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};

  // Canonical mapping: header bucket name → QuotaData field name
  // Source: spec.md FR-2 table + plan §API Contracts
  const CANONICAL = {
    '5h':          'five_hour',
    '7d':          'seven_day',
    '7d_sonnet':   'seven_day_sonnet',
    '7d_opus':     'seven_day_opus',
    '7d_omelette': 'seven_day_omelette',
    'overage':     'extra_usage',
  };

  const UTIL_RE = /^anthropic-ratelimit-unified-(.+)-utilization$/i;

  // Lowercase all header keys for case-insensitive matching (HTTP headers are
  // case-insensitive per RFC 7230; Node lowercases them in http.IncomingMessage
  // but tests may supply mixed-case inputs)
  const lc = {};
  for (const key of Object.keys(headers)) {
    lc[key.toLowerCase()] = headers[key];
  }

  const result = {};

  for (const key of Object.keys(lc)) {
    const m = UTIL_RE.exec(key);
    if (!m) continue;

    const bucket = m[1];             // e.g. "5h", "7d", "7d_haiku"
    const rawUtil = lc[key];

    const utilization = parseFloat(rawUtil);
    // Drop the bucket entirely on malformed numeric (NaN guard)
    if (isNaN(utilization)) continue;

    const prefix = `anthropic-ratelimit-unified-${bucket}`;
    const resets_at = lc[`${prefix}-reset`] != null ? lc[`${prefix}-reset`] : null;
    const status    = lc[`${prefix}-status`] != null ? lc[`${prefix}-status`] : undefined;

    const entry = { utilization, resets_at };
    if (status !== undefined) entry.status = status;

    const canonical = CANONICAL[bucket.toLowerCase()];
    if (canonical) {
      result[canonical] = entry;
    } else {
      // Pass-through-unknown: preserve verbatim under quotas[<bucket>] per C3
      if (!result.quotas) result.quotas = {};
      result.quotas[bucket] = entry;
    }
  }

  return result;
}

module.exports = { parseRateLimitHeaders };
