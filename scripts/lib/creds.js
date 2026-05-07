'use strict';

/**
 * creds.js — read OAuth credentials from ~/.claude/.credentials.json.
 *
 * Two exports:
 *   readOAuthToken(fsAccess)         → string | null  (v4.7.0 semantics preserved 1:1)
 *   readCredentialsExpiresAt(fsAccess) → number | null  (ms-since-epoch or null)
 *
 * Both accept an optional `fsAccess` argument:
 *   { readFileSync(path, encoding): string, existsSync(path): boolean }
 *
 * When `fsAccess` is undefined, the real `fs` module is used — preserving
 * v4.7.0 standalone behaviour (no breaking change, NFR-3).
 *
 * Extraction source: scripts/statusline.js v4.7.0 lines 128-161.
 * Semantics are byte-identical to the original for readOAuthToken.
 * readCredentialsExpiresAt is a new helper reading the sibling field.
 *
 * No proxy-specific string literals in this file (FR-1).
 * Zero new npm dependencies (NFR-4).
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fsBuiltin = require('fs');
const os = require('os');

/**
 * Safely navigate a dot-separated path in an object.
 * Inline copy — avoids a dependency on statusline.js internals.
 *
 * @param {unknown} obj
 * @param {string} dotPath
 * @returns {unknown}
 */
function getPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Return the path to ~/.claude/.credentials.json.
 *
 * @returns {string}
 */
function credPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

/**
 * Read the OAuth access token from Claude Code credentials.
 *
 * Resolution order (v4.7.0 behaviour preserved 1:1 — NFR-3):
 *   1. macOS keychain: security find-generic-password -s 'Claude Code-credentials' -w
 *   2. ~/.claude/.credentials.json claudeAiOauth.accessToken (Win / Linux / macOS fallback)
 *
 * @param {Object} [fsAccess] - optional fs-like object with readFileSync(path, enc).
 *   When omitted, the built-in fs module is used (v4.7.0 standalone mode).
 * @returns {string|null}
 */
function readOAuthToken(fsAccess) {
  const fsr = fsAccess || fsBuiltin;
  try {
    if (process.platform === 'darwin') {
      // macOS: try keychain first
      const result = spawnSync('security', [
        'find-generic-password',
        '-s', 'Claude Code-credentials',
        '-w',
      ], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        try {
          const creds = JSON.parse(result.stdout.trim());
          const token = getPath(creds, 'claudeAiOauth.accessToken');
          if (token) return token;
        } catch {
          // keychain data not valid JSON, fall through to file
        }
      }
    }

    // Win/Linux (and macOS fallback): read credentials file
    const raw = fsr.readFileSync(credPath(), 'utf8');
    const creds = JSON.parse(raw);
    return getPath(creds, 'claudeAiOauth.accessToken') || null;
  } catch {
    return null;
  }
}

/**
 * Read the OAuth token expiry timestamp from Claude Code credentials.
 *
 * Reads `claudeAiOauth.expiresAt` from ~/.claude/.credentials.json.
 * Returns ms-since-epoch (number) or null when not present / unreadable.
 *
 * @param {Object} [fsAccess] - optional fs-like object with readFileSync(path, enc)
 *   and existsSync(path). When omitted, the built-in fs module is used.
 * @returns {number|null}
 */
function readCredentialsExpiresAt(fsAccess) {
  const fsr = fsAccess || fsBuiltin;
  try {
    const cp = credPath();
    if (fsr.existsSync && !fsr.existsSync(cp)) return null;
    const raw = fsr.readFileSync(cp, 'utf8');
    const creds = JSON.parse(raw);
    const expiresAt = getPath(creds, 'claudeAiOauth.expiresAt');
    if (expiresAt == null) return null;
    // Accept ms-since-epoch (number) or ISO-8601 string
    if (typeof expiresAt === 'number') return expiresAt;
    if (typeof expiresAt === 'string') {
      const ms = Date.parse(expiresAt);
      return Number.isNaN(ms) ? null : ms;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { readOAuthToken, readCredentialsExpiresAt };
