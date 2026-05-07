'use strict';

/**
 * topology.test.js — unit tests for detectTopology(env, fsAccess)
 *
 * Test runner: node:test (built-in, no new deps — NFR-4)
 * Run: node --test scripts/test/topology.test.js
 *
 * 8 required cases from tasks.md T1 VE:
 *  1. Native (no env, no creds) → { target: api.anthropic.com, authToken: null, authSource: null }
 *  2. Native (no env, fresh creds) → authToken from creds
 *  3. Proxy via ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN → both env values used
 *  4. Proxy with trailing slash in URL → stripped
 *  5. ANTHROPIC_API_KEY only (no ANTHROPIC_AUTH_TOKEN) → fallback to ANTHROPIC_API_KEY
 *  6. ANTHROPIC_AUTH_TOKEN set + creds also valid → env wins
 *  7. ANTHROPIC_BASE_URL = 'https://api.anthropic.com' literal → treated as native (no special path)
 *  8. Empty string env-var → treated as unset (falsy)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectTopology } = require('../lib/topology');

// ---- Helpers ---------------------------------------------------------------

/**
 * Build a minimal fsAccess mock that provides an in-memory credentials file.
 *
 * @param {string|null} token - access token to embed, or null for missing/invalid creds
 * @returns {{ readFileSync: Function, existsSync: Function }}
 */
function makeFsAccess(token) {
  if (token === null) {
    // Simulate no credentials file on disk
    return {
      existsSync: () => false,
      readFileSync: () => { throw new Error('ENOENT'); },
    };
  }
  const content = JSON.stringify({ claudeAiOauth: { accessToken: token } });
  return {
    existsSync: () => true,
    readFileSync: () => content,
  };
}

/** fsAccess that returns malformed JSON — simulates corrupt creds file */
const corruptFsAccess = {
  existsSync: () => true,
  readFileSync: () => 'NOT_VALID_JSON!!!',
};

/** fsAccess that returns valid JSON but missing the token field */
const noTokenFsAccess = {
  existsSync: () => true,
  readFileSync: () => JSON.stringify({ claudeAiOauth: {} }),
};

// ---- Test cases ------------------------------------------------------------

// Case 1: Native — no env vars, no creds file
test('case 1: native (no env, no creds) → api.anthropic.com, no auth', () => {
  const result = detectTopology({}, makeFsAccess(null));

  assert.equal(result.target, 'https://api.anthropic.com');
  assert.equal(result.authToken, null);
  assert.equal(result.authSource, null);
});

// Case 2: Native — no env vars, creds file present
test('case 2: native (no env, fresh creds) → authToken from creds.json', () => {
  const result = detectTopology({}, makeFsAccess('oauth-token-abc'));

  assert.equal(result.target, 'https://api.anthropic.com');
  assert.equal(result.authToken, 'oauth-token-abc');
  assert.equal(result.authSource, 'creds.json');
});

// Case 3: Proxy — ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN set
test('case 3: proxy via ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN → both env values used', () => {
  const env = {
    ANTHROPIC_BASE_URL: 'http://unleashed.lan:8321',
    ANTHROPIC_AUTH_TOKEN: 'proxy-bearer-xyz',
  };
  const result = detectTopology(env, makeFsAccess(null));

  assert.equal(result.target, 'http://unleashed.lan:8321');
  assert.equal(result.authToken, 'proxy-bearer-xyz');
  assert.equal(result.authSource, 'env:ANTHROPIC_AUTH_TOKEN');
});

// Case 4: Proxy URL with trailing slash → stripped
test('case 4: ANTHROPIC_BASE_URL with trailing slash → target has slash stripped', () => {
  const env = {
    ANTHROPIC_BASE_URL: 'http://unleashed.lan:8321/',
    ANTHROPIC_AUTH_TOKEN: 'proxy-bearer-xyz',
  };
  const result = detectTopology(env, makeFsAccess(null));

  assert.equal(result.target, 'http://unleashed.lan:8321');
});

// Case 5: ANTHROPIC_API_KEY only (no ANTHROPIC_AUTH_TOKEN)
test('case 5: ANTHROPIC_API_KEY only → authToken from ANTHROPIC_API_KEY, no creds fallback needed', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant-api03-test' };
  const result = detectTopology(env, makeFsAccess(null));

  assert.equal(result.target, 'https://api.anthropic.com');
  assert.equal(result.authToken, 'sk-ant-api03-test');
  assert.equal(result.authSource, 'env:ANTHROPIC_API_KEY');
});

// Case 6: ANTHROPIC_AUTH_TOKEN wins over creds.json
test('case 6: ANTHROPIC_AUTH_TOKEN set + creds also valid → env wins', () => {
  const env = { ANTHROPIC_AUTH_TOKEN: 'env-token-wins' };
  const result = detectTopology(env, makeFsAccess('creds-token-loses'));

  assert.equal(result.authToken, 'env-token-wins');
  assert.equal(result.authSource, 'env:ANTHROPIC_AUTH_TOKEN');
});

// Case 7: ANTHROPIC_BASE_URL = 'https://api.anthropic.com' literal → treated as native
test('case 7: ANTHROPIC_BASE_URL set to api.anthropic.com literal → target is api.anthropic.com', () => {
  const env = { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
  const result = detectTopology(env, makeFsAccess(null));

  // No special path — just resolves normally, trailing slash not present
  assert.equal(result.target, 'https://api.anthropic.com');
  assert.equal(result.authToken, null);
  assert.equal(result.authSource, null);
});

// Case 8: Empty string env-var → treated as unset (falls through to creds)
test('case 8: empty string env-var → treated as unset, falls through to creds.json', () => {
  const env = {
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_BASE_URL: '',
  };
  const result = detectTopology(env, makeFsAccess('creds-token-fallback'));

  assert.equal(result.target, 'https://api.anthropic.com');
  assert.equal(result.authToken, 'creds-token-fallback');
  assert.equal(result.authSource, 'creds.json');
});

// --- Extra robustness cases beyond the 8 required ---

// ANTHROPIC_API_KEY wins over creds when AUTH_TOKEN absent
test('extra: ANTHROPIC_API_KEY wins over creds.json when ANTHROPIC_AUTH_TOKEN absent', () => {
  const env = { ANTHROPIC_API_KEY: 'api-key-wins' };
  const result = detectTopology(env, makeFsAccess('creds-should-lose'));

  assert.equal(result.authToken, 'api-key-wins');
  assert.equal(result.authSource, 'env:ANTHROPIC_API_KEY');
});

// Corrupt creds.json → graceful null
test('extra: corrupt creds.json → authToken null, no throw', () => {
  const result = detectTopology({}, corruptFsAccess);

  assert.equal(result.authToken, null);
  assert.equal(result.authSource, null);
});

// Creds with missing accessToken field → null
test('extra: creds.json present but claudeAiOauth.accessToken missing → authToken null', () => {
  const result = detectTopology({}, noTokenFsAccess);

  assert.equal(result.authToken, null);
  assert.equal(result.authSource, null);
});

// Multiple trailing slashes stripped
test('extra: multiple trailing slashes → all stripped from target', () => {
  const env = {
    ANTHROPIC_BASE_URL: 'http://proxy.local:9000///',
    ANTHROPIC_AUTH_TOKEN: 'token',
  };
  const result = detectTopology(env, makeFsAccess(null));

  assert.equal(result.target, 'http://proxy.local:9000');
});
