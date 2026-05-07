'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { parseRateLimitHeaders } = require('../lib/quota-parser');

// ---------------------------------------------------------------------------
// TC1: All 6 known buckets present → 6 canonical fields populated
// ---------------------------------------------------------------------------
test('TC1: all 6 known buckets → 6 canonical fields', () => {
  const headers = {
    'anthropic-ratelimit-unified-5h-utilization':        '0.56',
    'anthropic-ratelimit-unified-5h-reset':              '1777683000',
    'anthropic-ratelimit-unified-5h-status':             'allowed',
    'anthropic-ratelimit-unified-7d-utilization':        '0.99',
    'anthropic-ratelimit-unified-7d-reset':              '1778007600',
    'anthropic-ratelimit-unified-7d-status':             'allowed_warning',
    'anthropic-ratelimit-unified-7d_sonnet-utilization': '0.27',
    'anthropic-ratelimit-unified-7d_sonnet-reset':       '1778007600',
    'anthropic-ratelimit-unified-7d_sonnet-status':      'allowed',
    'anthropic-ratelimit-unified-7d_opus-utilization':   '0.10',
    'anthropic-ratelimit-unified-7d_opus-reset':         '1778007600',
    'anthropic-ratelimit-unified-7d_opus-status':        'allowed',
    'anthropic-ratelimit-unified-7d_omelette-utilization': '0.05',
    'anthropic-ratelimit-unified-7d_omelette-reset':     '1778007600',
    'anthropic-ratelimit-unified-7d_omelette-status':    'allowed',
    'anthropic-ratelimit-unified-overage-utilization':   '0.0',
    'anthropic-ratelimit-unified-overage-reset':         '1780272000',
    'anthropic-ratelimit-unified-overage-status':        'allowed',
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok('five_hour'          in result, 'five_hour present');
  assert.ok('seven_day'          in result, 'seven_day present');
  assert.ok('seven_day_sonnet'   in result, 'seven_day_sonnet present');
  assert.ok('seven_day_opus'     in result, 'seven_day_opus present');
  assert.ok('seven_day_omelette' in result, 'seven_day_omelette present');
  assert.ok('extra_usage'        in result, 'extra_usage present');

  assert.strictEqual(result.five_hour.utilization, 0.56);
  assert.strictEqual(result.seven_day.utilization, 0.99);
  assert.strictEqual(result.extra_usage.utilization, 0.0);

  // No unknown buckets spill into quotas
  assert.strictEqual(result.quotas, undefined);
});

// ---------------------------------------------------------------------------
// TC2: Unknown bucket `7d_haiku` → preserved under quotas['7d_haiku']
// ---------------------------------------------------------------------------
test('TC2: unknown bucket 7d_haiku → quotas[7d_haiku]', () => {
  const headers = {
    'anthropic-ratelimit-unified-7d_haiku-utilization': '0.33',
    'anthropic-ratelimit-unified-7d_haiku-reset':       '1778007600',
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok(!('seven_day_haiku' in result), 'no spurious canonical field');
  assert.ok(result.quotas && '7d_haiku' in result.quotas, 'quotas[7d_haiku] present');
  assert.strictEqual(result.quotas['7d_haiku'].utilization, 0.33);
  assert.strictEqual(result.quotas['7d_haiku'].resets_at, '1778007600');
});

// ---------------------------------------------------------------------------
// TC3: Empty headers → returns {} without throwing
// ---------------------------------------------------------------------------
test('TC3: empty headers → {}', () => {
  const result = parseRateLimitHeaders({});
  assert.deepStrictEqual(result, {});
});

// Also confirm null/undefined don't throw
test('TC3b: null headers → {}', () => {
  const result = parseRateLimitHeaders(null);
  assert.deepStrictEqual(result, {});
});

// ---------------------------------------------------------------------------
// TC4: Mixed-case header keys → normalized + parsed
// ---------------------------------------------------------------------------
test('TC4: mixed-case header keys normalized', () => {
  const headers = {
    'Anthropic-Ratelimit-Unified-5H-Utilization': '0.42',
    'ANTHROPIC-RATELIMIT-UNIFIED-5H-RESET':       '1777683000',
    'Anthropic-Ratelimit-Unified-5H-Status':      'allowed',
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok('five_hour' in result, 'five_hour parsed from mixed-case key');
  assert.strictEqual(result.five_hour.utilization, 0.42);
  assert.strictEqual(result.five_hour.resets_at, '1777683000');
  assert.strictEqual(result.five_hour.status, 'allowed');
});

// ---------------------------------------------------------------------------
// TC5: *-utilization without sibling *-reset → bucket present, resets_at null
// ---------------------------------------------------------------------------
test('TC5: utilization without reset → resets_at: null', () => {
  const headers = {
    'anthropic-ratelimit-unified-7d-utilization': '0.5',
    // no 7d-reset header
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok('seven_day' in result, 'seven_day present');
  assert.strictEqual(result.seven_day.resets_at, null);
  assert.strictEqual(result.seven_day.utilization, 0.5);
});

// ---------------------------------------------------------------------------
// TC6: Malformed numeric (`utilization: "abc"` → NaN) → bucket dropped, others preserved
// ---------------------------------------------------------------------------
test('TC6: malformed utilization dropped, others preserved', () => {
  const headers = {
    'anthropic-ratelimit-unified-5h-utilization': 'abc',   // malformed — should be dropped
    'anthropic-ratelimit-unified-7d-utilization': '0.75',
    'anthropic-ratelimit-unified-7d-reset':       '1778007600',
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok(!('five_hour' in result), 'five_hour dropped due to NaN utilization');
  assert.ok('seven_day' in result,    'seven_day still present');
  assert.strictEqual(result.seven_day.utilization, 0.75);
});

// ---------------------------------------------------------------------------
// TC7: 11-bucket fixture (hand-coded analog of quota-status.json all_headers)
//      6 canonical + 5 unknown → all 11 preserved
//
//  Canonical mapping:
//    5h          → five_hour
//    7d          → seven_day
//    7d_sonnet   → seven_day_sonnet
//    7d_opus     → seven_day_opus
//    7d_omelette → seven_day_omelette
//    overage     → extra_usage
//  Unknown buckets (preserve verbatim under quotas[]):
//    7d_oauth_apps, 7d_cowork, tangelo, iguana_necktie, omelette_promotional
// ---------------------------------------------------------------------------
test('TC7: 11-bucket fixture → all 11 preserved (6 canonical + 5 unknown)', () => {
  const headers = {
    // 6 canonical
    'anthropic-ratelimit-unified-5h-utilization':        '0.56',
    'anthropic-ratelimit-unified-5h-reset':              '1777683000',
    'anthropic-ratelimit-unified-7d-utilization':        '0.99',
    'anthropic-ratelimit-unified-7d-reset':              '1778007600',
    'anthropic-ratelimit-unified-7d_sonnet-utilization': '0.27',
    'anthropic-ratelimit-unified-7d_sonnet-reset':       '1778007600',
    'anthropic-ratelimit-unified-7d_opus-utilization':   '0.10',
    'anthropic-ratelimit-unified-7d_opus-reset':         '1778007600',
    'anthropic-ratelimit-unified-7d_omelette-utilization': '0.05',
    'anthropic-ratelimit-unified-7d_omelette-reset':     '1778007600',
    'anthropic-ratelimit-unified-overage-utilization':   '0.0',
    'anthropic-ratelimit-unified-overage-reset':         '1780272000',
    // 5 unknown
    'anthropic-ratelimit-unified-7d_oauth_apps-utilization':      '0.15',
    'anthropic-ratelimit-unified-7d_oauth_apps-reset':            '1778007600',
    'anthropic-ratelimit-unified-7d_cowork-utilization':          '0.08',
    'anthropic-ratelimit-unified-7d_cowork-reset':                '1778007600',
    'anthropic-ratelimit-unified-tangelo-utilization':            '0.02',
    'anthropic-ratelimit-unified-tangelo-reset':                  '1778007600',
    'anthropic-ratelimit-unified-iguana_necktie-utilization':     '0.01',
    'anthropic-ratelimit-unified-iguana_necktie-reset':           '1778007600',
    'anthropic-ratelimit-unified-omelette_promotional-utilization': '0.30',
    'anthropic-ratelimit-unified-omelette_promotional-reset':     '1778007600',
    // Unrelated headers (should be ignored)
    'anthropic-ratelimit-unified-representative-claim': 'seven_day',
    'anthropic-ratelimit-unified-fallback':             'available',
    'request-id':                                       'req_abc123',
  };

  const result = parseRateLimitHeaders(headers);

  // 6 canonical fields
  assert.ok('five_hour'          in result, 'five_hour');
  assert.ok('seven_day'          in result, 'seven_day');
  assert.ok('seven_day_sonnet'   in result, 'seven_day_sonnet');
  assert.ok('seven_day_opus'     in result, 'seven_day_opus');
  assert.ok('seven_day_omelette' in result, 'seven_day_omelette');
  assert.ok('extra_usage'        in result, 'extra_usage');

  // 5 unknown buckets in quotas map
  assert.ok(result.quotas, 'quotas map present');
  assert.ok('7d_oauth_apps'        in result.quotas, '7d_oauth_apps in quotas');
  assert.ok('7d_cowork'            in result.quotas, '7d_cowork in quotas');
  assert.ok('tangelo'              in result.quotas, 'tangelo in quotas');
  assert.ok('iguana_necktie'       in result.quotas, 'iguana_necktie in quotas');
  assert.ok('omelette_promotional' in result.quotas, 'omelette_promotional in quotas');

  // Total: 11 buckets preserved
  const canonicalCount = ['five_hour','seven_day','seven_day_sonnet','seven_day_opus','seven_day_omelette','extra_usage']
    .filter(k => k in result).length;
  const unknownCount = Object.keys(result.quotas || {}).length;
  assert.strictEqual(canonicalCount + unknownCount, 11, '11 total buckets');
});

// ---------------------------------------------------------------------------
// TC8: Status field captured when present
// ---------------------------------------------------------------------------
test('TC8: status field captured', () => {
  const headers = {
    'anthropic-ratelimit-unified-7d-utilization': '0.99',
    'anthropic-ratelimit-unified-7d-reset':       '1778007600',
    'anthropic-ratelimit-unified-7d-status':      'allowed_warning',
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok('seven_day' in result);
  assert.strictEqual(result.seven_day.status, 'allowed_warning');
});

// Also verify: status absent when header not present
test('TC8b: status field absent when not present', () => {
  const headers = {
    'anthropic-ratelimit-unified-5h-utilization': '0.5',
  };

  const result = parseRateLimitHeaders(headers);

  assert.ok('five_hour' in result);
  assert.ok(!('status' in result.five_hour), 'no spurious status field');
});

// ---------------------------------------------------------------------------
// TC9: Resets preserved as raw string — both ISO 8601 and unix-seconds string
// ---------------------------------------------------------------------------
test('TC9a: resets_at preserved as ISO 8601 string (no conversion)', () => {
  const headers = {
    'anthropic-ratelimit-unified-5h-utilization': '0.5',
    'anthropic-ratelimit-unified-5h-reset':       '2026-05-07T18:30:00.000Z',
  };

  const result = parseRateLimitHeaders(headers);
  // Raw value preserved — downstream uses Date constructor
  assert.strictEqual(result.five_hour.resets_at, '2026-05-07T18:30:00.000Z');
});

test('TC9b: resets_at preserved as unix-seconds string (no conversion)', () => {
  const headers = {
    'anthropic-ratelimit-unified-7d-utilization': '0.75',
    'anthropic-ratelimit-unified-7d-reset':       '1778007600',
  };

  const result = parseRateLimitHeaders(headers);
  // Raw string preserved — NOT parsed to a number
  assert.strictEqual(result.seven_day.resets_at, '1778007600');
  assert.strictEqual(typeof result.seven_day.resets_at, 'string');
});

// ---------------------------------------------------------------------------
// TC10: Unrelated `anthropic-ratelimit-tokens-*` headers → ignored entirely
// ---------------------------------------------------------------------------
test('TC10: anthropic-ratelimit-tokens-* namespace ignored', () => {
  const headers = {
    'anthropic-ratelimit-tokens-limit':     '100000',
    'anthropic-ratelimit-tokens-remaining': '87500',
    'anthropic-ratelimit-tokens-reset':     '1778007600',
    'anthropic-ratelimit-requests-limit':   '50',
    // One real header to confirm parser still works
    'anthropic-ratelimit-unified-5h-utilization': '0.20',
    'anthropic-ratelimit-unified-5h-reset':       '1777683000',
  };

  const result = parseRateLimitHeaders(headers);

  // Only the unified utilization bucket should be parsed
  assert.ok('five_hour' in result, 'five_hour present');
  assert.strictEqual(Object.keys(result).length, 1, 'exactly 1 top-level bucket key');
});
