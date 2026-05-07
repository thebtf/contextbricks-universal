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
/**
 * Normalize a *-reset header value into an ISO-8601 string Date can parse.
 *
 * The Messages API response (when proxied through CPA or hit directly) returns
 * `anthropic-ratelimit-unified-*-reset` as a UNIX-SECONDS string (e.g. "1777683000").
 * The OAuth /api/oauth/usage endpoint returns ISO-8601. Downstream `new Date(x)`
 * does not parse a 10-digit unix-seconds string correctly — yields Invalid Date.
 *
 * Detection: pure digits and length 9-11 → unix seconds. Otherwise pass through
 * (ISO 8601, ms-string, or anything else Date already understands).
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function normalizeResetValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  // Unix seconds: 9-11 digit integer (covers 2001-09-09 through 5138-11-16).
  if (/^\d{9,11}$/.test(s)) {
    const ms = Number(s) * 1000;
    return new Date(ms).toISOString();
  }
  // Unix milliseconds: 13-digit integer.
  if (/^\d{13}$/.test(s)) {
    return new Date(Number(s)).toISOString();
  }
  // ISO 8601 or unknown — pass through unchanged.
  return s;
}

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
    const rawReset = lc[`${prefix}-reset`];
    const resets_at = normalizeResetValue(rawReset);
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
