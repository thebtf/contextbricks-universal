'use strict';

/**
 * creds.test.js — unit tests for readOAuthToken and readCredentialsExpiresAt.
 *
 * Test runner: node:test (built-in, no new deps — NFR-4)
 * Run: node --test scripts/test/creds.test.js
 *
 * 4 required cases from tasks.md T3 VE:
 *  1. creds.json present + valid → token returned, expiresAt returned
 *  2. creds.json missing → null + null (silent fail)
 *  3. creds.json malformed JSON → null + null
 *  4. creds.json present but missing claudeAiOauth.accessToken field → null + null (token)
 *
 * Additional cases for coverage and robustness.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readOAuthToken, readCredentialsExpiresAt } = require('../lib/creds');

// ---- Helpers ----------------------------------------------------------------

/**
 * Build a minimal fsAccess mock backed by in-memory creds content.
 *
 * @param {Object|null} credsObject - parsed object to serialize, or null for missing file
 * @returns {{ readFileSync: Function, existsSync: Function }}
 */
function makeFsAccess(credsObject) {
  if (credsObject === null) {
    return {
      existsSync: () => false,
      readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    };
  }
  const content = JSON.stringify(credsObject);
  return {
    existsSync: () => true,
    readFileSync: () => content,
  };
}

/** fsAccess that returns unparseable bytes */
const malformedFsAccess = {
  existsSync: () => true,
  readFileSync: () => '{{NOT_VALID_JSON!!! <<>>',
};

// ---- Case 1: creds.json present + valid ------------------------------------

test('case 1a: creds.json present + valid → readOAuthToken returns token string', () => {
  const fs = makeFsAccess({
    claudeAiOauth: { accessToken: 'sk-oauth-test-token-abc123', expiresAt: 1700000000000 },
  });
  const token = readOAuthToken(fs);
  assert.equal(token, 'sk-oauth-test-token-abc123');
});

test('case 1b: creds.json present + valid → readCredentialsExpiresAt returns ms number', () => {
  const expiresAtMs = 1700000000000;
  const fs = makeFsAccess({
    claudeAiOauth: { accessToken: 'sk-oauth-test-token-abc123', expiresAt: expiresAtMs },
  });
  const result = readCredentialsExpiresAt(fs);
  assert.equal(result, expiresAtMs);
});

test('case 1c: expiresAt as ISO-8601 string → readCredentialsExpiresAt parses to ms', () => {
  const isoString = '2025-06-01T12:00:00.000Z';
  const expectedMs = Date.parse(isoString);
  const fs = makeFsAccess({
    claudeAiOauth: { accessToken: 'token', expiresAt: isoString },
  });
  const result = readCredentialsExpiresAt(fs);
  assert.equal(result, expectedMs);
});

// ---- Case 2: creds.json missing --------------------------------------------

test('case 2a: creds.json missing → readOAuthToken returns null (silent fail)', () => {
  const token = readOAuthToken(makeFsAccess(null));
  assert.equal(token, null);
});

test('case 2b: creds.json missing → readCredentialsExpiresAt returns null (silent fail)', () => {
  const result = readCredentialsExpiresAt(makeFsAccess(null));
  assert.equal(result, null);
});

// ---- Case 3: creds.json malformed JSON -------------------------------------

test('case 3a: creds.json malformed JSON → readOAuthToken returns null', () => {
  const token = readOAuthToken(malformedFsAccess);
  assert.equal(token, null);
});

test('case 3b: creds.json malformed JSON → readCredentialsExpiresAt returns null', () => {
  const result = readCredentialsExpiresAt(malformedFsAccess);
  assert.equal(result, null);
});

// ---- Case 4: creds.json present but missing claudeAiOauth.accessToken ------

test('case 4a: claudeAiOauth.accessToken missing → readOAuthToken returns null', () => {
  const fs = makeFsAccess({ claudeAiOauth: { expiresAt: 1700000000000 } });
  const token = readOAuthToken(fs);
  assert.equal(token, null);
});

test('case 4b: claudeAiOauth key missing entirely → readOAuthToken returns null', () => {
  const fs = makeFsAccess({ someOtherField: 'value' });
  const token = readOAuthToken(fs);
  assert.equal(token, null);
});

test('case 4c: claudeAiOauth.expiresAt missing → readCredentialsExpiresAt returns null', () => {
  const fs = makeFsAccess({ claudeAiOauth: { accessToken: 'token' } });
  const result = readCredentialsExpiresAt(fs);
  assert.equal(result, null);
});

// ---- Additional robustness cases -------------------------------------------

test('extra: empty object in creds.json → both helpers return null without throwing', () => {
  const fs = makeFsAccess({});
  assert.equal(readOAuthToken(fs), null);
  assert.equal(readCredentialsExpiresAt(fs), null);
});

test('extra: claudeAiOauth.accessToken is empty string → readOAuthToken returns null', () => {
  // getPath returns '' which is falsy — preserved v4.7.0 behaviour
  const fs = makeFsAccess({ claudeAiOauth: { accessToken: '' } });
  const token = readOAuthToken(fs);
  assert.equal(token, null);
});

test('extra: readCredentialsExpiresAt with invalid ISO string → returns null', () => {
  const fs = makeFsAccess({ claudeAiOauth: { expiresAt: 'not-a-date' } });
  const result = readCredentialsExpiresAt(fs);
  assert.equal(result, null);
});
