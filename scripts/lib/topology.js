'use strict';

/**
 * topology.js — detect upstream target and auth token from environment + creds file.
 *
 * detectTopology(env, fsAccess) → { target, authToken, authSource }
 *
 * Pure function: no global process.env reads outside the `env` argument;
 * no global fs reads outside the `fsAccess` argument.
 *
 * Token resolution order (mirrors Claude Code's own logic — FR-1):
 *   1. env.ANTHROPIC_AUTH_TOKEN
 *   2. env.ANTHROPIC_API_KEY
 *   3. fsAccess.readCredsToken() (reads ~/.claude/.credentials.json)
 *   4. null
 *
 * Target resolution (FR-1):
 *   env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'  (trailing slash stripped)
 */

const os = require('os');
const path = require('path');

/**
 * Read the OAuth access token from the credentials file via the provided fs accessor.
 * Returns the token string or null.
 *
 * @param {Object} fsAccess - object exposing readFileSync(path, encoding) and existsSync(path)
 * @returns {string|null}
 */
function readCredsToken(fsAccess) {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (!fsAccess.existsSync(credPath)) return null;
    const raw = fsAccess.readFileSync(credPath, 'utf8');
    const creds = JSON.parse(raw);
    // Navigate claudeAiOauth.accessToken safely
    const oauth = creds && typeof creds === 'object' ? creds.claudeAiOauth : undefined;
    const token = oauth && typeof oauth === 'object' ? oauth.accessToken : undefined;
    return (typeof token === 'string' && token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * Detect the upstream topology (target URL + auth token + auth source).
 *
 * @param {Object} env     - environment variable map (e.g. process.env); read-only
 * @param {Object} fsAccess - object exposing readFileSync(path, encoding) and existsSync(path)
 * @returns {{ target: string, authToken: string|null, authSource: string|null }}
 */
function detectTopology(env, fsAccess) {
  // Resolve upstream target — strip trailing slash
  const rawBase = (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.trim()) || '';
  const target = rawBase
    ? rawBase.replace(/\/+$/, '')
    : 'https://api.anthropic.com';

  // Token resolution chain: env.ANTHROPIC_AUTH_TOKEN → env.ANTHROPIC_API_KEY → creds.json → null
  if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_AUTH_TOKEN.trim()) {
    return {
      target,
      authToken: env.ANTHROPIC_AUTH_TOKEN.trim(),
      authSource: 'env:ANTHROPIC_AUTH_TOKEN',
    };
  }

  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim()) {
    return {
      target,
      authToken: env.ANTHROPIC_API_KEY.trim(),
      authSource: 'env:ANTHROPIC_API_KEY',
    };
  }

  const credsToken = readCredsToken(fsAccess);
  if (credsToken) {
    return {
      target,
      authToken: credsToken,
      authSource: 'creds.json',
    };
  }

  return { target, authToken: null, authSource: null };
}

module.exports = { detectTopology };
