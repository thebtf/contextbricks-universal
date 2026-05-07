'use strict';

/**
 * quota-source.js — HeaderProbeQuotaSource + NullSource
 *
 * HeaderProbeQuotaSource: cache → HTTP probe → parse pipeline
 *   - Cache freshness state machine: FRESH < 180s, STALE < 24h, UNAVAILABLE ≥ 24h
 *   - Probe model fallback chain: haiku-4-5 → haiku-3-5 → 3-5-haiku-20241022
 *   - Anthropic-beta header fallback: claude-code-20250219 → no-beta on 4xx
 *   - Atomic write: tmp+rename POSIX-atomic; Windows EBUSY retry-once + direct fallback
 *   - Parse-fail-self-heal on corrupt cache JSON
 *   - FR-9 token confidentiality: cache stores only parsed quotas + meta; token via env to subprocess
 *
 * NullSource: terminator returning hint_kind per FR-8 enum
 *
 * Per spec.md FR-2/FR-4/FR-5/FR-8/FR-9/NFR-1/NFR-2/NFR-5, C2, C4, tasks.md T4.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRateLimitHeaders } = require('./quota-parser');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hardcoded probe model fallback chain — cheapest Haiku variants (FR-4) */
const PROBE_MODELS = [
  'claude-haiku-4-5',
  'claude-haiku-3-5',
  'claude-3-5-haiku-20241022',
];

/** Cache freshness windows (milliseconds) */
const FRESH_TTL_MS = 180 * 1000;       // 180 s → FRESH
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h → STALE fallback allowed

/** Cache schema version — readers reject mismatches (parse-fail-self-heal per C4) */
const SCHEMA_VERSION = 'v5.0.0';

/** Starting anthropic-beta header value (Open Q2 resolution per plan) */
const DEFAULT_ANTHROPIC_BETA = 'claude-code-20250219';

/** Probe timeout in ms (NFR-2) */
const PROBE_TIMEOUT_MS = 4000;

// ---------------------------------------------------------------------------
// NullSource
// ---------------------------------------------------------------------------

/**
 * Terminator source: emitted when no quota data is available.
 *
 * @param {{ topology: object, hint_kind: string }} opts
 */
class NullSource {
  constructor({ topology, hint_kind }) {
    this.topology = topology;
    // hint_kind is one of the FR-8 enum literals — never interpolated token values
    this.hint_kind = hint_kind;
  }

  fetch() {
    return {
      data: null,
      freshness: 'UNAVAILABLE',
      age_ms: Infinity,
      source_id: 'null',
      hint_kind: this.hint_kind,
    };
  }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Read and validate a cache record from disk. Returns null on any failure
 * (ENOENT, corrupt JSON, missing required fields, schema version mismatch).
 *
 * @param {string} cachePath
 * @param {object} fsAccess  — object with readFileSync
 * @returns {{ data: object, timestamp_ms: number, probe_model: string, schema_version: string, anthropic_beta: string|null }|null}
 */
function readCache(cachePath, fsAccess) {
  try {
    const raw = fsAccess.readFileSync(cachePath, 'utf8');
    const record = JSON.parse(raw);

    // Schema version guard — treat mismatches as no cache (parse-fail-self-heal per C4)
    if (!record || typeof record !== 'object') return null;
    if (record.schema_version !== SCHEMA_VERSION) return null;
    if (!record.data || typeof record.timestamp_ms !== 'number') return null;

    return record;
  } catch {
    // ENOENT, JSON.parse failure, any fs error → treat as no cache
    return null;
  }
}

/**
 * Write a cache record atomically.
 * POSIX: tmp+rename (kernel-atomic per NFR-5).
 * Windows: tmp+rename; on EBUSY retry once after 50ms; on second failure direct write.
 * Silent fail on any write error — cache is best-effort.
 *
 * @param {string} cachePath
 * @param {object} record  — cache record to serialise
 * @param {object} fsAccess — object with writeFileSync, renameSync
 */
function writeCache(cachePath, record, fsAccess) {
  const body = JSON.stringify(record);
  const tmpPath = `${cachePath}.tmp`;

  try {
    fsAccess.writeFileSync(tmpPath, body, { mode: 0o600 });
  } catch {
    // Can't even write the temp file — abort silently
    return;
  }

  if (process.platform !== 'win32') {
    // POSIX: rename is atomic
    try {
      fsAccess.renameSync(tmpPath, cachePath);
    } catch {
      // Rename failed on POSIX — try direct write as last resort
      try {
        fsAccess.writeFileSync(cachePath, body, { mode: 0o600 });
      } catch {
        // silent
      }
    }
    return;
  }

  // Windows: EBUSY retry once after 50ms (C4)
  function tryRename() {
    try {
      fsAccess.renameSync(tmpPath, cachePath);
      return true;
    } catch (err) {
      if (err && err.code === 'EBUSY') return false;
      // Non-EBUSY error on Windows — fall through to direct write
      return null;
    }
  }

  const first = tryRename();
  if (first === true) return;

  if (first === false) {
    // EBUSY — wait 50ms, retry once
    const deadline = Date.now() + 50;
    while (Date.now() < deadline) { /* spin — synchronous 50ms pause */ }
    const second = tryRename();
    if (second === true) return;
  }

  // Fallback: direct write (last resort per C4)
  try {
    fsAccess.writeFileSync(cachePath, body, { mode: 0o600 });
  } catch {
    // silent
  }
}

// ---------------------------------------------------------------------------
// Probe helper
// ---------------------------------------------------------------------------

/**
 * Execute one HTTP probe via spawnSync(node, ['-e', script]).
 * Token is passed via env — never via argv (FR-9 INVARIANT-3).
 *
 * @param {{ target: string, authToken: string, model: string, anthropic_beta: string|null }} opts
 * @param {number} timeout
 * @returns {{ status: number, headers: object, body: string, error?: string }}
 */
function runProbe({ target, authToken, model, anthropic_beta }, timeout) {
  // The script writes JSON: { status, headers, body } to stdout, nothing to stderr.
  // Token is never in the script string itself — only referenced via process.env.ANTHROPIC_TOKEN
  // anthropic_beta is passed via PROBE_BETA env var (never embedded in the script string)

  // Build URL parts from target string
  // target may be "https://api.anthropic.com" or "http://host:port"
  const httpsScript = `
    const https = require('https');
    const http = require('http');
    const url = require('url');

    const TARGET = process.env.PROBE_TARGET;
    const MODEL = process.env.PROBE_MODEL;
    const BETA = process.env.PROBE_BETA || '';

    const parsed = url.parse(TARGET + '/v1/messages');
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqHeaders = {
      'Authorization': 'Bearer ' + process.env.ANTHROPIC_TOKEN,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    if (BETA) reqHeaders['anthropic-beta'] = BETA;

    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    });
    reqHeaders['content-length'] = Buffer.byteLength(body).toString();

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method: 'POST',
      headers: reqHeaders,
    };

    const req = lib.request(options, (res) => {
      let respBody = '';
      let total = 0;
      const MAX = 64 * 1024;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX) return;
        respBody += chunk;
      });
      res.on('end', () => {
        const out = {
          status: res.statusCode,
          headers: res.headers,
          body: respBody.slice(0, 1024),
        };
        process.stdout.write(JSON.stringify(out));
      });
    });
    req.on('error', () => {
      process.stdout.write(JSON.stringify({ status: 0, headers: {}, body: '', error: 'NETWORK_FAIL' }));
    });
    req.write(body);
    req.end();
  `;

  const result = spawnSync(process.execPath, ['-e', httpsScript], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
    env: {
      ...process.env,
      ANTHROPIC_TOKEN: authToken,
      PROBE_TARGET: target,
      PROBE_MODEL: model,
      PROBE_BETA: anthropic_beta || '',
    },
  });

  if (!result.stdout || result.status !== 0) {
    return { status: 0, headers: {}, body: '', error: 'NETWORK_FAIL' };
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return { status: 0, headers: {}, body: '', error: 'NETWORK_FAIL' };
  }
}

/**
 * Determine if a non-200 4xx status looks like "model not found".
 * Tolerant match against body text per the spec.
 *
 * @param {number} status
 * @param {string} body
 * @returns {boolean}
 */
function isModelNotFound(status, body) {
  if (status !== 404 && (status < 400 || status >= 500)) return false;
  if (status === 401 || status === 403) return false;
  if (status === 429) return false;
  const b = (body || '').toLowerCase();
  return b.includes('model not found') || b.includes('not_found') || status === 404;
}

// ---------------------------------------------------------------------------
// HeaderProbeQuotaSource
// ---------------------------------------------------------------------------

/**
 * Primary quota source: reads cache → probes /v1/messages → parses response headers.
 *
 * Constructor options:
 *   topology     {object}   — { target, authToken, authSource } from detectTopology()
 *   cachePath    {string}   — absolute path for on-disk cache (default: ~/.claude/.contextbricks-quota-cache.json)
 *   nowMs        {number}   — current time in ms (for testability; defaults to Date.now())
 *   mockProbeFn  {Function|null} — when non-null, replaces real spawnSync HTTP probe with mock
 *   fsAccess     {object|null}   — when non-null, replaces real fs module with mock
 */
class HeaderProbeQuotaSource {
  constructor({ topology, cachePath, nowMs, mockProbeFn = null, fsAccess = null }) {
    this.topology = topology;
    this.cachePath = cachePath || path.join(os.homedir(), '.claude', '.contextbricks-quota-cache.json');
    this.nowMs = typeof nowMs === 'number' ? nowMs : Date.now();
    this.mockProbeFn = mockProbeFn;
    this._fs = fsAccess || {
      readFileSync: fs.readFileSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      renameSync: fs.renameSync.bind(fs),
    };
  }

  /**
   * Fetch quota data.
   *
   * Returns QuotaResult:
   *   { data: QuotaData|null, freshness: 'FRESH'|'STALE'|'UNAVAILABLE', age_ms, source_id, hint_kind? }
   *
   * @returns {object}
   */
  fetch() {
    // Step 1: No auth token → cost-zero return (NFR-1)
    if (!this.topology.authToken) {
      return new NullSource({ topology: this.topology, hint_kind: 'no-auth' }).fetch();
    }

    // Step 2: Read cache
    const cache = readCache(this.cachePath, this._fs);

    // Step 3: Compute age
    const age_ms = cache
      ? Math.max(0, this.nowMs - cache.timestamp_ms)
      : Infinity;

    // Step 4: Cache hit — FRESH (age < 180s)
    if (cache && age_ms < FRESH_TTL_MS) {
      return {
        data: cache.data,
        freshness: 'FRESH',
        age_ms,
        source_id: 'hdr-probe',
      };
    }

    // Step 5: Cache miss or stale — attempt probe
    const probeResult = this._probe(cache);

    if (probeResult.success) {
      // Probe succeeded — return FRESH
      return {
        data: probeResult.data,
        freshness: 'FRESH',
        age_ms: 0,
        source_id: 'hdr-probe',
      };
    }

    // Step 6: STALE-or-null logic
    return this._staleOrNull(cache, age_ms, probeResult.hint_kind);
  }

  /**
   * Run the probe with model fallback chain + anthropic-beta fallback.
   * Returns { success: true, data } on success or { success: false, hint_kind } on failure.
   *
   * @param {object|null} cache
   * @returns {{ success: boolean, data?: object, hint_kind?: string }}
   */
  _probe(cache) {
    const { target, authToken } = this.topology;

    // Build the effective chain. Priority order:
    //   1. CONTEXTBRICKS_QUOTA_PROBE_MODEL env override (user-explicit) — first
    //   2. Cached working model (last successful probe) — second
    //   3. Default fallback chain (haiku tiers + safety net) — rest
    // This handles proxies whose model dispatcher uses non-Anthropic-native
    // names: the user pins a model that round-trips successfully via env.
    const userPinnedModel = process.env.CONTEXTBRICKS_QUOTA_PROBE_MODEL;
    const cachedModel = cache && cache.probe_model;
    const seen = new Set();
    const modelChain = [];
    for (const candidate of [userPinnedModel, cachedModel, ...PROBE_MODELS]) {
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate);
        modelChain.push(candidate);
      }
    }

    // Determine starting anthropic-beta value
    // If cache has a recorded value (including null = "no beta"), use it.
    // Otherwise use the default.
    let anthropic_beta = (cache && Object.prototype.hasOwnProperty.call(cache, 'anthropic_beta'))
      ? cache.anthropic_beta
      : DEFAULT_ANTHROPIC_BETA;

    for (const model of modelChain) {
      const probeResponse = this._callProbe({ target, authToken, model, anthropic_beta });

      const { status, headers, body } = probeResponse;

      if (probeResponse.error === 'NETWORK_FAIL' || status === 0) {
        return { success: false, hint_kind: 'upstream-5xx' };
      }

      if (status === 200) {
        // Parse headers — if empty, do NOT poison cache (spec step 7)
        const parsed = parseRateLimitHeaders(headers);
        if (!parsed || Object.keys(parsed).length === 0) {
          return { success: false, hint_kind: 'no-headers' };
        }

        // Write cache — only parsed quota values + meta (FR-9 INVARIANT-1)
        const record = {
          data: parsed,
          timestamp_ms: this.nowMs,
          probe_model: model,
          schema_version: SCHEMA_VERSION,
          anthropic_beta: anthropic_beta,   // persist working beta value (or null for no-beta)
        };
        writeCache(this.cachePath, record, this._fs);

        return { success: true, data: parsed };
      }

      // 4xx responses
      if (status >= 400 && status < 500) {
        // 401/403 — auth rejected
        if (status === 401 || status === 403) {
          return { success: false, hint_kind: 'auth-rejected' };
        }

        // 429 — treat as auth-rejected (informational; retry is per-render)
        if (status === 429) {
          return { success: false, hint_kind: 'auth-rejected' };
        }

        // Model not found — advance chain BEFORE attempting beta-retry.
        // Beta-retry on the same not-found model would burn a probe slot
        // against a model the upstream rejected outright; skip it.
        if (isModelNotFound(status, body)) {
          continue;
        }

        // Other 4xx — try no-beta retry once if we haven't already
        if (anthropic_beta !== null) {
          const retryResponse = this._callProbe({ target, authToken, model, anthropic_beta: null });
          if (retryResponse.status === 200) {
            const parsed = parseRateLimitHeaders(retryResponse.headers);
            if (!parsed || Object.keys(parsed).length === 0) {
              return { success: false, hint_kind: 'no-headers' };
            }
            // Persist null beta (no-beta path works)
            const record = {
              data: parsed,
              timestamp_ms: this.nowMs,
              probe_model: model,
              schema_version: SCHEMA_VERSION,
              anthropic_beta: null,
            };
            writeCache(this.cachePath, record, this._fs);
            return { success: true, data: parsed };
          }
          // No-beta retry also non-200 — if it's model-not-found, advance chain;
          // if it's anything else 4xx, treat as upstream error.
          if (isModelNotFound(retryResponse.status, retryResponse.body)) {
            anthropic_beta = null;
            continue;
          }
          // Update for next iteration in case chain advances naturally
          anthropic_beta = null;
        }

        // Other 4xx (non-model-not-found, non-auth) — treat as upstream error
        return { success: false, hint_kind: 'upstream-5xx' };
      }

      // 5xx or network
      return { success: false, hint_kind: 'upstream-5xx' };
    }

    // All models exhausted
    return { success: false, hint_kind: 'no-model' };
  }

  /**
   * Invoke the probe — either the real spawnSync subprocess or the mockProbeFn.
   *
   * @param {{ target, authToken, model, anthropic_beta }} opts
   * @returns {{ status, headers, body, error? }}
   */
  _callProbe({ target, authToken, model, anthropic_beta }) {
    if (this.mockProbeFn) {
      return this.mockProbeFn({ target, model, anthropic_beta, headers: {}, body: {} });
    }
    return runProbe({ target, authToken, model, anthropic_beta }, PROBE_TIMEOUT_MS);
  }

  /**
   * Return STALE result if cache is usable, else UNAVAILABLE via NullSource.
   *
   * @param {object|null} cache
   * @param {number} age_ms
   * @param {string} hint_kind
   * @returns {object}
   */
  _staleOrNull(cache, age_ms, hint_kind) {
    if (cache && age_ms < STALE_WINDOW_MS) {
      return {
        data: cache.data,
        freshness: 'STALE',
        age_ms,
        source_id: 'cache-stale',
        hint_kind,
      };
    }
    return new NullSource({ topology: this.topology, hint_kind }).fetch();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { HeaderProbeQuotaSource, NullSource };
