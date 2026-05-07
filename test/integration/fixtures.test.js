'use strict';

/**
 * fixtures.test.js — Integration test runner for stdin-mock contract (C5, NFR-6)
 *
 * Each test:
 *   1. Spawns `node scripts/statusline.js` with spawnSync
 *   2. Pipes a fixture JSON to stdin
 *   3. Sets CONTEXTBRICKS_CACHE_PATH to a per-test temp file (cache isolation)
 *   4. Captures stdout, strips ANSI escape codes
 *   5. Asserts SEMANTIC presence:
 *      - For FRESH fixtures: canonical bucket name + percentage
 *      - For UNAVAILABLE fixtures: exact hint_kind literal from FR-8 enum
 *
 * No byte-identity snapshots — avoids brittleness from ANSI and zero-value variations.
 *
 * Test runner: node:test (built-in, zero new deps — NFR-4)
 * Run: node --test test/integration/fixtures.test.js
 *
 * Per spec.md NFR-6, C5, FR-8, tasks.md T7.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUSLINE = path.join(__dirname, '..', '..', 'scripts', 'statusline.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/** Regex matching any ANSI escape sequence */
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from a string.
 *
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

/**
 * Run scripts/statusline.js with the given fixture JSON as stdin.
 * Returns the stdout with ANSI stripped.
 *
 * @param {string} fixtureName  — filename in fixtures/ dir (without path)
 * @param {object} [extraEnv]   — additional env vars to set (merged with process.env)
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function runFixture(fixtureName, extraEnv) {
  const fixturePath = path.join(FIXTURES_DIR, fixtureName);
  const fixtureJson = fs.readFileSync(fixturePath, 'utf8');

  // Per-test temp cache file for isolation — prevents real user cache from
  // interfering with freshness state-machine assertions (no CONTEXTBRICKS_CACHE_PATH
  // support existed before T7; this env var was added in T7 to statusline.js).
  const tmpCache = path.join(os.tmpdir(), `cb-quota-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const env = {
    ...process.env,
    CONTEXTBRICKS_CACHE_PATH: tmpCache,
    CONTEXTBRICKS_SHOW_LIMITS: '1',
    CONTEXTBRICKS_SHOW_CACHE_FIX: '0',
    CONTEXTBRICKS_WIDTH: '120',
    ...extraEnv,
  };

  const result = spawnSync(process.execPath, [STATUSLINE], {
    input: fixtureJson,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
    env,
  });

  // Clean up temp cache file
  try { fs.unlinkSync(tmpCache); } catch { /* best-effort */ }
  try { fs.unlinkSync(tmpCache + '.tmp'); } catch { /* best-effort */ }

  return {
    stdout: stripAnsi(result.stdout || ''),
    stderr: result.stderr || '',
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: native-fresh
// FRESH path — probe 200 with full unified-* headers.
// Expected Line 4: session and week quota segments with % values.
// ---------------------------------------------------------------------------

test('native-fresh: FRESH quota segments rendered (session + week canonical buckets)', () => {
  const { stdout, status } = runFixture('native-fresh.json');

  assert.strictEqual(status, 0, `Process exited non-zero. stdout:\n${stdout}`);

  // Line 4 must contain session (5h bucket) percentage — 28% from fixture
  assert.ok(
    stdout.includes('session:28%') || stdout.includes('s:28%'),
    `Expected session:28% or s:28% in output.\nstdout:\n${stdout}`
  );

  // Line 4 must contain week (7d bucket) percentage — 7% from fixture
  assert.ok(
    stdout.includes('week:7%') || stdout.includes('w:7%'),
    `Expected week:7% or w:7% in output.\nstdout:\n${stdout}`
  );

  // Must NOT contain UNAVAILABLE hint literals
  assert.ok(
    !stdout.includes('[no API auth'),
    `Should not contain no-auth hint.\nstdout:\n${stdout}`
  );
  assert.ok(
    !stdout.includes('[API unreachable'),
    `Should not contain service degraded hint.\nstdout:\n${stdout}`
  );
});

// ---------------------------------------------------------------------------
// Fixture 2: native-expired
// UNAVAILABLE path — probe 401, no usable cache.
// Expected Line 4: [auth token rejected — refresh credentials]
// ---------------------------------------------------------------------------

test('native-expired: UNAVAILABLE hint auth-rejected rendered', () => {
  const { stdout, status } = runFixture('native-expired.json');

  assert.strictEqual(status, 0, `Process exited non-zero. stdout:\n${stdout}`);

  // FR-8 literal must appear exactly
  assert.ok(
    stdout.includes('[auth token rejected — refresh credentials]'),
    `Expected auth-rejected hint in output.\nstdout:\n${stdout}`
  );

  // Must NOT contain quota utilization segments (session: label is distinctive)
  assert.ok(
    !stdout.includes('session:'),
    `Should not contain session segment when UNAVAILABLE.\nstdout:\n${stdout}`
  );
});

// ---------------------------------------------------------------------------
// Fixture 3: proxy-happy
// FRESH path — proxy topology, probe 200 with full unified-* headers.
// Expected Line 4: full quota render (proxy is transparent — same rendering as native).
// ---------------------------------------------------------------------------

test('proxy-happy: proxy topology, FRESH quota segments rendered', () => {
  const { stdout, status } = runFixture('proxy-happy.json');

  assert.strictEqual(status, 0, `Process exited non-zero. stdout:\n${stdout}`);

  // Line 4 must contain session (5h) — 45% from fixture
  assert.ok(
    stdout.includes('session:45%') || stdout.includes('s:45%'),
    `Expected session:45% or s:45% in output.\nstdout:\n${stdout}`
  );

  // Line 4 must contain week (7d) — 12% from fixture
  assert.ok(
    stdout.includes('week:12%') || stdout.includes('w:12%'),
    `Expected week:12% or w:12% in output.\nstdout:\n${stdout}`
  );

  // Must NOT contain UNAVAILABLE hint literals
  assert.ok(
    !stdout.includes('[API unreachable'),
    `Should not contain service degraded hint.\nstdout:\n${stdout}`
  );
});

// ---------------------------------------------------------------------------
// Fixture 4: proxy-5xx-all-models
// UNAVAILABLE path — proxy returns 502.
// 502 is a 5xx so isModelNotFound returns false; hint_kind = 'upstream-5xx'.
// Expected Line 4: [API unreachable — service degraded]
//
// Note: The implementation (quota-source.js) classifies 5xx as 'upstream-5xx'
// regardless of response body. A 502 with "unknown provider for model" body
// does NOT trigger the model-not-found chain (which only applies to 4xx).
// See isModelNotFound(): status >= 500 → returns false unconditionally.
// ---------------------------------------------------------------------------

test('proxy-5xx-all-models: 502 produces upstream-5xx hint (service degraded)', () => {
  const { stdout, status } = runFixture('proxy-5xx-all-models.json');

  assert.strictEqual(status, 0, `Process exited non-zero. stdout:\n${stdout}`);

  // FR-8 literal: upstream-5xx maps to [API unreachable — service degraded]
  assert.ok(
    stdout.includes('[API unreachable — service degraded]'),
    `Expected upstream-5xx hint in output.\nstdout:\n${stdout}`
  );
});

// ---------------------------------------------------------------------------
// Fixture 5: no-config
// UNAVAILABLE path — no auth in mock env; creds.json isolated via HOME override.
// Expected Line 4: [no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]
//
// Cache isolation: CONTEXTBRICKS_CACHE_PATH set to temp file.
// Auth isolation: HOME (Linux/Mac) and USERPROFILE (Windows) pointed at a temp
// directory that has no ~/.claude/.credentials.json, preventing real creds from
// polluting the no-auth assertion.
// ---------------------------------------------------------------------------

test('no-config: no auth produces no-auth hint', () => {
  // Create a temp HOME directory with no credentials
  const tmpHome = path.join(os.tmpdir(), `cb-test-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpHome, { recursive: true });

  try {
    const { stdout, status } = runFixture('no-config.json', {
      // Override home to prevent real creds.json from being read
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      HOMEDRIVE: tmpHome.slice(0, 2),
      HOMEPATH: tmpHome.slice(2),
    });

    assert.strictEqual(status, 0, `Process exited non-zero. stdout:\n${stdout}`);

    // FR-8 literal: no-auth maps to [no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]
    assert.ok(
      stdout.includes('[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]'),
      `Expected no-auth hint in output.\nstdout:\n${stdout}`
    );

    // Must NOT contain quota utilization segments (session: label is distinctive)
    assert.ok(
      !stdout.includes('session:'),
      `Should not contain session segment when UNAVAILABLE.\nstdout:\n${stdout}`
    );
  } finally {
    // Clean up temp HOME
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
