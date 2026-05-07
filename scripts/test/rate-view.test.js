'use strict';

/**
 * rate-view.test.js — unit tests for buildRateView
 *
 * Test runner: node:test (built-in — NFR-4)
 * Run: node --test scripts/test/rate-view.test.js
 *
 * Required cases (≥6) from tasks.md T5 VE:
 *  1. FRESH result → merged.freshness = 'FRESH', merged.source_id = 'hdr-probe', quota fields populated
 *  2. STALE result → merged.freshness = 'STALE', merged.source_id = 'cache-stale', age_ms surfaced
 *  3. UNAVAILABLE no-auth → merged.freshness = 'UNAVAILABLE', merged.hint_kind = 'no-auth', all null
 *  4. Unknown bucket (quotas.seven_day_haiku) → passes through on source data
 *  5. cfExtras present → merged.extras populated
 *  6. cfExtras absent → merged.extras has null/false defaults
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRateView } = require('../lib/rate-view');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Fixed nowMs for deterministic pacing/burn — resets_at set in the future
const NOW_MS = 1746720000000; // 2026-05-08T12:00:00Z (fixed)

// A future reset time for 5h window: 3 hours from now
const RESET_5H = new Date(NOW_MS + 3 * 3600 * 1000).toISOString();
// A future reset time for 7d window: 4 days from now
const RESET_7D = new Date(NOW_MS + 4 * 86400 * 1000).toISOString();

/** QuotaResult with FRESH freshness and populated data */
function makeFreshResult() {
  return {
    data: {
      five_hour: { utilization: 0.31, resets_at: RESET_5H },
      seven_day: { utilization: 0.42, resets_at: RESET_7D },
      seven_day_sonnet: { utilization: 0.22, resets_at: RESET_7D },
    },
    freshness: 'FRESH',
    age_ms: 45000,
    source_id: 'hdr-probe',
  };
}

/** QuotaResult with STALE freshness (cache hit but probe failed) */
function makeStaleResult() {
  return {
    data: {
      five_hour: { utilization: 0.55, resets_at: RESET_5H },
      seven_day: { utilization: 0.33, resets_at: RESET_7D },
    },
    freshness: 'STALE',
    age_ms: 5400000, // 90 minutes
    source_id: 'cache-stale',
    hint_kind: 'upstream-5xx',
  };
}

/** QuotaResult from NullSource — no-auth scenario */
function makeUnavailableNoAuth() {
  return {
    data: null,
    freshness: 'UNAVAILABLE',
    age_ms: Infinity,
    source_id: 'null',
    hint_kind: 'no-auth',
  };
}

/** QuotaResult with unknown bucket in data.quotas (C3 pass-through) */
function makeResultWithUnknownBucket() {
  return {
    data: {
      five_hour: { utilization: 0.10, resets_at: RESET_5H },
      quotas: {
        seven_day_haiku: { utilization: 0.05, resets_at: RESET_7D },
      },
    },
    freshness: 'FRESH',
    age_ms: 10000,
    source_id: 'hdr-probe',
  };
}

/** cfExtras with all fields populated */
const CF_EXTRAS = {
  ttl_tier: '1h',
  hit_rate: 99,
  peak_hour: true,
  overage: '',
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test('TC-RV-1: FRESH result — freshness, source_id, quota fields populated', () => {
  const result = makeFreshResult();
  const merged = buildRateView(result, null, NOW_MS);

  assert.equal(merged.freshness, 'FRESH', 'freshness must be FRESH');
  assert.equal(merged.source_id, 'hdr-probe', 'source_id must be hdr-probe');
  assert.equal(merged.age_ms, 45000, 'age_ms must pass through');

  assert.ok(merged.session, 'session must be populated from five_hour');
  // utilization is converted from 0..1 ratio to 0..100 percentage scale in buildRateView (NFR-3)
  assert.equal(merged.session.utilization, 31, 'session utilization must be 0..100 scale');
  assert.equal(merged.session.resets_at, RESET_5H, 'session resets_at must match');

  assert.ok(merged.week, 'week must be populated from seven_day');
  assert.equal(merged.week.utilization, 42, 'week utilization must be 0..100 scale');

  assert.ok(merged.sonnet, 'sonnet must be populated from seven_day_sonnet');
  assert.equal(merged.sonnet.utilization, 22, 'sonnet utilization must be 0..100 scale');

  assert.equal(merged.opus, null, 'opus must be null (not in data)');
  assert.equal(merged.design, null, 'design must be null (not in data)');
});

test('TC-RV-2: STALE result — freshness, source_id, age_ms surfaced', () => {
  const result = makeStaleResult();
  const merged = buildRateView(result, null, NOW_MS);

  assert.equal(merged.freshness, 'STALE', 'freshness must be STALE');
  assert.equal(merged.source_id, 'cache-stale', 'source_id must be cache-stale');
  assert.equal(merged.age_ms, 5400000, 'age_ms must be 5400000 (90 min)');
  assert.equal(merged.hint_kind, 'upstream-5xx', 'hint_kind must pass through');

  assert.ok(merged.session, 'stale data still maps session');
  // Float precision: 0.55 * 100 = 55.00000000000001. Use tolerance instead of strictEqual.
  assert.ok(Math.abs(merged.session.utilization - 55) < 0.001, 'stale session utilization converted to 0..100 (within float tolerance)');
  assert.ok(merged.week, 'stale data still maps week');
});

test('TC-RV-3: UNAVAILABLE no-auth — freshness, hint_kind, all quotas null', () => {
  const result = makeUnavailableNoAuth();
  const merged = buildRateView(result, null, NOW_MS);

  assert.equal(merged.freshness, 'UNAVAILABLE', 'freshness must be UNAVAILABLE');
  assert.equal(merged.hint_kind, 'no-auth', 'hint_kind must be no-auth');
  assert.equal(merged.source_id, 'null', 'source_id must be null');

  assert.equal(merged.session, null, 'session must be null when data is null');
  assert.equal(merged.week, null, 'week must be null');
  assert.equal(merged.sonnet, null, 'sonnet must be null');
  assert.equal(merged.opus, null, 'opus must be null');
  assert.equal(merged.design, null, 'design must be null');
  assert.equal(merged.extra_usage, null, 'extra_usage must be null');
});

test('TC-RV-4: unknown bucket (quotas.seven_day_haiku) passes through on source data', () => {
  const result = makeResultWithUnknownBucket();
  const merged = buildRateView(result, null, NOW_MS);

  // The unknown bucket is NOT rendered as a canonical field
  assert.equal(merged.freshness, 'FRESH');
  assert.ok(merged.session, 'known bucket five_hour maps to session');

  // The unknown bucket data is available on the original quotaResult.data.quotas
  // (not on merged, but preserved in source — C3 pass-through)
  assert.ok(result.data.quotas, 'source data.quotas must be present');
  assert.ok(result.data.quotas.seven_day_haiku, 'unknown bucket preserved in source');

  // merged does NOT have a "haiku" field — it only has the canonical 5
  assert.equal(merged.opus, null, 'unknown bucket not projected to canonical opus field');
  assert.equal(merged.design, null, 'unknown bucket not projected to canonical design field');
});

test('TC-RV-5: cfExtras present — merged.extras populated correctly', () => {
  const result = makeFreshResult();
  const merged = buildRateView(result, CF_EXTRAS, NOW_MS);

  assert.equal(merged.extras.ttl, '1h', 'extras.ttl must be ttl_tier');
  assert.equal(merged.extras.hit, 99, 'extras.hit must be hit_rate');
  assert.equal(merged.extras.peak, true, 'extras.peak must be peak_hour');
  assert.equal(merged.extras.overage, '', 'extras.overage must be overage string');
});

test('TC-RV-6: cfExtras absent — merged.extras has null/false defaults', () => {
  const result = makeFreshResult();
  const merged = buildRateView(result, null, NOW_MS);

  assert.equal(merged.extras.ttl, null, 'extras.ttl must be null when no cfExtras');
  assert.equal(merged.extras.hit, null, 'extras.hit must be null');
  assert.equal(merged.extras.peak, false, 'extras.peak must be false');
  assert.equal(merged.extras.overage, '', 'extras.overage must be empty string');
});

test('TC-RV-7: quotaResult.data with extra_usage field — mapped correctly', () => {
  const result = {
    data: {
      five_hour: { utilization: 0.20, resets_at: RESET_5H },
      extra_usage: { used_credits: 5000, monthly_limit: 100000, is_enabled: true },
    },
    freshness: 'FRESH',
    age_ms: 30000,
    source_id: 'hdr-probe',
  };
  const merged = buildRateView(result, null, NOW_MS);

  assert.ok(merged.extra_usage, 'extra_usage must be populated');
  assert.equal(merged.extra_usage.usedCredits, 5000, 'usedCredits must match');
  assert.equal(merged.extra_usage.monthlyLimit, 100000, 'monthlyLimit must match');
  assert.equal(merged.extra_usage.enabled, true, 'enabled must match');
});

test('TC-RV-8: design (seven_day_omelette) only appears when resets_at present', () => {
  const resultWith = {
    data: {
      five_hour: { utilization: 0.10, resets_at: RESET_5H },
      seven_day_omelette: { utilization: 0.05, resets_at: RESET_7D },
    },
    freshness: 'FRESH',
    age_ms: 0,
    source_id: 'hdr-probe',
  };
  const resultWithout = {
    data: {
      five_hour: { utilization: 0.10, resets_at: RESET_5H },
      seven_day_omelette: { utilization: 0.05 }, // no resets_at
    },
    freshness: 'FRESH',
    age_ms: 0,
    source_id: 'hdr-probe',
  };

  const mergedWith = buildRateView(resultWith, null, NOW_MS);
  assert.ok(mergedWith.design, 'design must be populated when resets_at present');

  const mergedWithout = buildRateView(resultWithout, null, NOW_MS);
  assert.equal(mergedWithout.design, null, 'design must be null when no resets_at');
});
