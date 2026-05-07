'use strict';

/**
 * quota-source.test.js — unit tests for HeaderProbeQuotaSource and NullSource
 *
 * Test runner: node:test (built-in, no new deps — NFR-4)
 * Run: node --test scripts/test/quota-source.test.js
 *
 * 13 required cases from tasks.md T4 VE:
 *  1.  Cache hit, age < 180s → no probe, returns FRESH
 *  2.  Cache miss → probe 200 OK → FRESH, cache written correctly (no token, no raw body)
 *  3.  Cache stale (age 5min), probe 5xx → returns STALE with cached data
 *  4.  Cache stale (age 25h), probe 5xx → returns UNAVAILABLE (NullSource)
 *  5.  Probe 401 → NullSource hint_kind="auth-rejected"
 *  6.  Probe model not found 4xx → advances chain, persists working model name
 *  7.  All probe models 4xx model-not-found → NullSource hint_kind="no-model"
 *  8.  Probe 200 with empty headers → NullSource hint_kind="no-headers", cache NOT written
 *  9.  No auth token → NullSource hint_kind="no-auth", mockProbeFn NOT called
 * 10.  Concurrent-write simulation → last-writer-wins, cache valid JSON
 * 11.  Corrupt cache JSON → silent re-probe, returns FRESH on probe success
 * 12.  Token NEVER appears in cache content (FR-9 INVARIANT-1)
 * 13.  Anthropic-beta fallback: default beta 4xx → retry no-beta 200 → cache.anthropic_beta = null
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HeaderProbeQuotaSource, NullSource } = require('../lib/quota-source');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Topology with auth token */
function makeTopology(overrides = {}) {
  return {
    target: 'https://api.anthropic.com',
    authToken: 'test-bearer-token',
    authSource: 'env:ANTHROPIC_AUTH_TOKEN',
    ...overrides,
  };
}

/** Topology with NO auth token */
function makeNoAuthTopology() {
  return { target: 'https://api.anthropic.com', authToken: null, authSource: null };
}

/** Valid quota headers for the 5h and 7d buckets */
const VALID_HEADERS = {
  'anthropic-ratelimit-unified-5h-utilization': '0.42',
  'anthropic-ratelimit-unified-5h-reset': '2026-05-07T14:00:00Z',
  'anthropic-ratelimit-unified-7d-utilization': '0.15',
  'anthropic-ratelimit-unified-7d-reset': '2026-05-14T00:00:00Z',
};

/** Expected parsed data from VALID_HEADERS */
const VALID_DATA = {
  five_hour: { utilization: 0.42, resets_at: '2026-05-07T14:00:00Z' },
  seven_day: { utilization: 0.15, resets_at: '2026-05-14T00:00:00Z' },
};

const SCHEMA_VERSION = 'v5.0.0';

/**
 * Build an in-memory fsAccess mock.
 *
 * @param {object|null} initialRecord — cache record to pre-seed, or null for empty
 * @returns {{ fs: object, getWritten: Function }}
 */
function makeFsAccess(initialRecord = null) {
  const store = {};
  if (initialRecord !== null) {
    store['cache'] = JSON.stringify(initialRecord);
  }
  const written = [];

  return {
    fs: {
      readFileSync(p, _enc) {
        if (Object.prototype.hasOwnProperty.call(store, 'cache')) {
          return store['cache'];
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
      writeFileSync(p, data, _opts) {
        store['cache'] = data;
        written.push({ path: p, data });
      },
      renameSync(src, dst) {
        // Simulate atomic rename: copy src to dst in store
        if (Object.prototype.hasOwnProperty.call(store, 'tmp')) {
          store['cache'] = store['tmp'];
          delete store['tmp'];
        } else {
          // src is the .tmp file written by writeFileSync
          store['cache'] = written.length ? written[written.length - 1].data : store['cache'];
        }
      },
    },
    getWritten() { return written; },
    getCache() { return store['cache']; },
  };
}

/**
 * Build a probe mock that returns the given response for all calls.
 *
 * @param {{ status, headers, body, error? }} response
 * @returns {{ fn: Function, calls: Array }}
 */
function makeProbe(response) {
  const calls = [];
  const fn = (opts) => {
    calls.push(opts);
    return response;
  };
  return { fn, calls };
}

/**
 * Build a probe mock that returns different responses per call index.
 *
 * @param {Array<{ status, headers, body }>} responses
 * @returns {{ fn: Function, calls: Array }}
 */
function makeSequentialProbe(responses) {
  const calls = [];
  let idx = 0;
  const fn = (opts) => {
    calls.push({ ...opts, idx });
    const resp = responses[idx] || responses[responses.length - 1];
    idx++;
    return resp;
  };
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// Case 1: Cache hit, age < 180s → no probe, returns FRESH
// ---------------------------------------------------------------------------

test('case 1: cache hit age < 180s → FRESH, mockProbeFn not called', () => {
  const NOW = 1_000_000_000_000;
  const cacheRecord = {
    data: VALID_DATA,
    timestamp_ms: NOW - 60_000, // 60s ago → FRESH
    probe_model: 'claude-haiku-4-5',
    schema_version: SCHEMA_VERSION,
    anthropic_beta: 'claude-code-20250219',
  };
  const { fs: mockFs } = makeFsAccess(cacheRecord);
  const probe = makeProbe({ status: 200, headers: VALID_HEADERS, body: '' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: mockFs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'FRESH');
  assert.equal(result.source_id, 'hdr-probe');
  assert.equal(result.age_ms, 60_000);
  assert.deepEqual(result.data, VALID_DATA);
  assert.equal(probe.calls.length, 0, 'probe must not be called on cache hit');
});

// ---------------------------------------------------------------------------
// Case 2: Cache miss → probe 200 OK → FRESH, cache written correctly
// ---------------------------------------------------------------------------

test('case 2: cache miss, probe 200 OK with valid headers → FRESH, cache written (no token, no raw body)', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null); // no cache
  const probe = makeProbe({ status: 200, headers: VALID_HEADERS, body: '{"id":"msg_123"}' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'FRESH');
  assert.equal(result.age_ms, 0);
  assert.deepEqual(result.data, VALID_DATA);

  // Verify cache was written
  const cacheContent = fsMock.getCache();
  assert.ok(cacheContent, 'cache should have been written');

  const cached = JSON.parse(cacheContent);
  assert.equal(cached.schema_version, SCHEMA_VERSION);
  assert.equal(typeof cached.timestamp_ms, 'number');
  assert.ok(cached.data, 'cache must contain data');

  // FR-9 INVARIANT-1: no bearer token, no raw response body in cache
  assert.ok(!cacheContent.includes('test-bearer-token'), 'bearer token must not appear in cache');
  assert.ok(!cacheContent.includes('msg_123'), 'raw response body must not appear in cache');
  assert.ok(!cacheContent.includes('Bearer'), 'Authorization header value must not appear in cache');
});

// ---------------------------------------------------------------------------
// Case 3: Cache stale (age 5min), probe 5xx → STALE with cached data
// ---------------------------------------------------------------------------

test('case 3: cache stale (5min), probe 5xx → STALE with cached data', () => {
  const NOW = 1_000_000_000_000;
  const FIVE_MIN = 5 * 60 * 1000;
  const cacheRecord = {
    data: VALID_DATA,
    timestamp_ms: NOW - FIVE_MIN,
    probe_model: 'claude-haiku-4-5',
    schema_version: SCHEMA_VERSION,
    anthropic_beta: null,
  };
  const { fs: mockFs } = makeFsAccess(cacheRecord);
  const probe = makeProbe({ status: 503, headers: {}, body: 'service unavailable' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: mockFs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'STALE');
  assert.equal(result.source_id, 'cache-stale');
  assert.equal(result.hint_kind, 'upstream-5xx');
  assert.deepEqual(result.data, VALID_DATA);
  assert.equal(result.age_ms, FIVE_MIN);
});

// ---------------------------------------------------------------------------
// Case 4: Cache stale (age 25h), probe 5xx → UNAVAILABLE (NullSource)
// ---------------------------------------------------------------------------

test('case 4: cache stale (25h), probe 5xx → UNAVAILABLE', () => {
  const NOW = 1_000_000_000_000;
  const TWENTY_FIVE_HOURS = 25 * 60 * 60 * 1000;
  const cacheRecord = {
    data: VALID_DATA,
    timestamp_ms: NOW - TWENTY_FIVE_HOURS,
    probe_model: 'claude-haiku-4-5',
    schema_version: SCHEMA_VERSION,
    anthropic_beta: null,
  };
  const { fs: mockFs } = makeFsAccess(cacheRecord);
  const probe = makeProbe({ status: 500, headers: {}, body: 'internal error' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: mockFs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.data, null);
  assert.equal(result.source_id, 'null');
  assert.equal(result.hint_kind, 'upstream-5xx');
});

// ---------------------------------------------------------------------------
// Case 5: Probe 401 → NullSource hint_kind="auth-rejected" (no cache)
// ---------------------------------------------------------------------------

test('case 5: probe 401 (no cache) → UNAVAILABLE hint_kind=auth-rejected', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null);
  const probe = makeProbe({ status: 401, headers: {}, body: '{"error":"unauthorized"}' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.hint_kind, 'auth-rejected');
  assert.equal(result.data, null);
});

// ---------------------------------------------------------------------------
// Case 6: Probe model-not-found 4xx → advances chain, persists working model
// ---------------------------------------------------------------------------

test('case 6: first model 404 (not found) → advances to second model, persists working name in cache', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null);

  // First call: 404 (first model not found). Second call: 200 (second model works)
  const probe = makeSequentialProbe([
    { status: 404, headers: {}, body: 'model not found' },
    { status: 200, headers: VALID_HEADERS, body: '' },
  ]);

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'FRESH');
  assert.ok(probe.calls.length >= 2, 'should have called probe at least twice');

  // Verify the first call used the first model and eventually the second model was tried
  assert.equal(probe.calls[0].model, 'claude-haiku-4-5', 'first call should use first model');
  // After model-not-found + beta retry, the chain advances to second model
  const secondModelCall = probe.calls.find(c => c.model === 'claude-haiku-3-5');
  assert.ok(secondModelCall, 'second model (claude-haiku-3-5) should have been tried');

  // Verify working model persisted in cache
  const cacheContent = fsMock.getCache();
  const cached = JSON.parse(cacheContent);
  assert.equal(cached.probe_model, 'claude-haiku-3-5', 'working model name should be persisted');
});

// ---------------------------------------------------------------------------
// Case 7: All models 4xx model-not-found → NullSource hint_kind="no-model"
// ---------------------------------------------------------------------------

test('case 7: all probe models return 404 not-found → UNAVAILABLE hint_kind=no-model', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null);
  // All calls return 404 model-not-found
  const probe = makeProbe({ status: 404, headers: {}, body: 'model not found' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.hint_kind, 'no-model');
  assert.equal(result.data, null);

  // All 3 models in chain should have been tried
  assert.ok(probe.calls.length >= 3, 'should try all 3 models');
});

// ---------------------------------------------------------------------------
// Case 8: Probe 200 with empty headers → UNAVAILABLE hint_kind="no-headers", cache NOT written
// ---------------------------------------------------------------------------

test('case 8: probe 200 with empty ratelimit headers → UNAVAILABLE hint_kind=no-headers, cache not poisoned', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null);
  // 200 OK but no anthropic-ratelimit-* headers
  const probe = makeProbe({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"msg_ok"}' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.hint_kind, 'no-headers');
  assert.equal(result.data, null);

  // Cache must NOT have been written (no poisoning)
  assert.equal(fsMock.getCache(), undefined, 'cache must not be written when headers empty');
});

// ---------------------------------------------------------------------------
// Case 9: No auth token → NullSource hint_kind="no-auth", probe NOT called
// ---------------------------------------------------------------------------

test('case 9: no auth token → UNAVAILABLE hint_kind=no-auth, probe not called (cost-zero NFR-1)', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null);
  const probe = makeProbe({ status: 200, headers: VALID_HEADERS, body: '' });

  const source = new HeaderProbeQuotaSource({
    topology: makeNoAuthTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.hint_kind, 'no-auth');
  assert.equal(result.data, null);
  assert.equal(probe.calls.length, 0, 'probe must NOT be called when no auth token');
});

// ---------------------------------------------------------------------------
// Case 10: Concurrent-write simulation → final cache is valid JSON (last-writer-wins)
// ---------------------------------------------------------------------------

test('case 10: concurrent writes → last-writer-wins, final cache is valid JSON', () => {
  const NOW = 1_000_000_000_000;

  // Shared store simulates the on-disk file
  const store = { value: null };
  const writeCalls = [];

  function makeConcurrentFs(writerName) {
    return {
      readFileSync(_p, _enc) {
        if (store.value === null) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return store.value;
      },
      writeFileSync(_p, data, _opts) {
        writeCalls.push({ writer: writerName, data });
        store.value = data; // last writer wins
      },
      renameSync(_src, _dst) {
        // rename: last tmp content wins
        if (writeCalls.length > 0) {
          store.value = writeCalls[writeCalls.length - 1].data;
        }
      },
    };
  }

  const probeA = makeProbe({ status: 200, headers: VALID_HEADERS, body: '' });
  const probeB = makeProbe({ status: 200, headers: VALID_HEADERS, body: '' });

  const sourceA = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probeA.fn,
    fsAccess: makeConcurrentFs('A'),
  });

  const sourceB = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probeB.fn,
    fsAccess: makeConcurrentFs('B'),
  });

  // Both fetch — simulates concurrent renders
  const resultA = sourceA.fetch();
  const resultB = sourceB.fetch();

  assert.equal(resultA.freshness, 'FRESH');
  assert.equal(resultB.freshness, 'FRESH');

  // Final cache value must be valid JSON
  assert.ok(store.value !== null, 'cache should have been written');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(store.value); }, 'final cache must be valid JSON');
  assert.equal(parsed.schema_version, 'v5.0.0');
});

// ---------------------------------------------------------------------------
// Case 11: Corrupt cache JSON → silent re-probe, returns FRESH
// ---------------------------------------------------------------------------

test('case 11: corrupt cache JSON on read → parse-fail-self-heal, probe fires, returns FRESH', () => {
  const NOW = 1_000_000_000_000;

  // fsAccess returns corrupt JSON
  const corruptFs = {
    readFileSync: () => 'THIS IS NOT VALID JSON !@#$',
    writeFileSync: (_p, _d, _o) => {},
    renameSync: (_s, _d) => {},
  };

  const probe = makeProbe({ status: 200, headers: VALID_HEADERS, body: '' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: corruptFs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'FRESH', 'should return FRESH after probe succeeds');
  assert.ok(probe.calls.length >= 1, 'probe should have been called after cache self-heal');
  assert.deepEqual(result.data, VALID_DATA);
});

// ---------------------------------------------------------------------------
// Case 12: Token redaction — bearer token never appears in cache content (FR-9 INVARIANT-1)
// ---------------------------------------------------------------------------

test('case 12: FR-9 token redaction — after 401 failure, cache file contains no bearer token patterns', () => {
  const NOW = 1_000_000_000_000;
  const TOKEN = 'sk-ant-api03-supersecret-token-that-must-not-leak-into-cache';
  const fsMock = makeFsAccess(null);

  // Simulate: first probe 401 (no cache written), then a subsequent fresh hit
  // We only care about the cache content post-401
  const probe = makeProbe({ status: 401, headers: {}, body: '{"error":"unauthorized"}' });

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology({ authToken: TOKEN }),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: probe.fn,
    fsAccess: fsMock.fs,
  });

  source.fetch();

  // On 401 with no cache, nothing gets written — that itself is the invariant
  const cacheContent = fsMock.getCache();
  if (cacheContent) {
    // If something was written, it must not contain the token
    assert.ok(
      !cacheContent.match(/Bearer\s+[a-zA-Z0-9_-]{8,}/),
      'Bearer token must not appear in cache content'
    );
    assert.ok(
      !cacheContent.match(/sk-[a-zA-Z0-9_-]{8,}/),
      'sk- prefixed key must not appear in cache content'
    );
    assert.ok(
      !cacheContent.includes(TOKEN),
      'full auth token must not appear in cache content'
    );
  }
  // The primary assertion: no cache written on 401 failure
  assert.equal(cacheContent, undefined, 'no cache should be written on 401 failure');
});

// ---------------------------------------------------------------------------
// Case 13: Anthropic-beta fallback — default beta 4xx → retry no-beta 200 → cache.anthropic_beta = null
// ---------------------------------------------------------------------------

test('case 13: anthropic-beta fallback — default beta returns 4xx, no-beta retry returns 200 → cache.anthropic_beta=null', () => {
  const NOW = 1_000_000_000_000;
  const fsMock = makeFsAccess(null);

  // The probe mock must distinguish calls with/without anthropic_beta
  const calls = [];
  const fn = (opts) => {
    calls.push(opts);
    if (opts.anthropic_beta === 'claude-code-20250219') {
      // First attempt with default beta fails
      return { status: 400, headers: {}, body: 'beta header not accepted' };
    }
    // Second attempt without beta succeeds
    return { status: 200, headers: VALID_HEADERS, body: '' };
  };

  const source = new HeaderProbeQuotaSource({
    topology: makeTopology(),
    cachePath: '/fake/cache.json',
    nowMs: NOW,
    mockProbeFn: fn,
    fsAccess: fsMock.fs,
  });

  const result = source.fetch();

  assert.equal(result.freshness, 'FRESH');

  // Verify the no-beta path was tried (a call with null anthropic_beta)
  const noBetaCall = calls.find(c => c.anthropic_beta === null || c.anthropic_beta === '');
  assert.ok(noBetaCall, 'should have retried without anthropic-beta');

  // Verify cache.anthropic_beta = null (persisted the working no-beta state)
  const cacheContent = fsMock.getCache();
  assert.ok(cacheContent, 'cache should have been written');
  const cached = JSON.parse(cacheContent);
  assert.equal(cached.anthropic_beta, null, 'cache.anthropic_beta should be null (no-beta worked)');
});

// ---------------------------------------------------------------------------
// NullSource direct tests
// ---------------------------------------------------------------------------

test('NullSource.fetch() returns canonical UNAVAILABLE shape with correct hint_kind', () => {
  const topology = makeNoAuthTopology();
  const source = new NullSource({ topology, hint_kind: 'no-auth' });
  const result = source.fetch();

  assert.equal(result.freshness, 'UNAVAILABLE');
  assert.equal(result.data, null);
  assert.equal(result.source_id, 'null');
  assert.equal(result.hint_kind, 'no-auth');
  assert.equal(result.age_ms, Infinity);
});

test('NullSource respects all 5 FR-8 hint_kind enum values', () => {
  const HINT_KINDS = ['no-auth', 'auth-rejected', 'upstream-5xx', 'no-headers', 'no-model'];
  for (const kind of HINT_KINDS) {
    const source = new NullSource({ topology: makeNoAuthTopology(), hint_kind: kind });
    const result = source.fetch();
    assert.equal(result.hint_kind, kind, `hint_kind '${kind}' must be preserved`);
    assert.equal(result.freshness, 'UNAVAILABLE');
  }
});
