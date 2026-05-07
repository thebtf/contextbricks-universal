'use strict';

/**
 * meter-extras.js — read optional TTL/hit/PEAK/OVERAGE extras from local meter files.
 *
 * readMeterExtras(input, nowMs) → { ttl_tier, hit_rate, peak_hour, overage, ts } | null
 *
 * Extracted from scripts/statusline.js v4.7.0 lines 715-790.
 * Semantics are byte-identical to the original (NFR-3/FR-7).
 *
 * Staleness gate: returns null when data is older than 30 minutes.
 * Mock: _mock_cache_fix on stdin short-circuits file I/O (C5 backwards compat).
 *
 * Sources (in priority order):
 *   1. stdin._mock_cache_fix (test mode — v4.7.0 mock key preserved)
 *   2. ~/.claude/claude-meter.jsonl (tail of last line)
 *   3. ~/.claude/quota-status.json (fallback)
 *
 * Per spec.md FR-7, NFR-3, plan.md §Component Map, tasks.md T6.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_AGE_MS = 30 * 60 * 1000; // 30 min — see ADR-003

function getPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Read meter extras record (TTL/hit/PEAK/OVERAGE) from local files.
 *
 * @param {object} input   — parsed stdin JSON (may contain _mock_cache_fix)
 * @param {number} nowMs   — current time in ms (same anchor as pacing/burn calculations)
 * @returns {{ ttl_tier: string|null, hit_rate: number|null, peak_hour: boolean, overage: string, ts: string }|null}
 */
function readMeterExtras(input, nowMs) {
  const mock = getPath(input, '_mock_cache_fix');
  if (mock !== undefined && mock !== null) {
    return gate(mock.ts || '', mock.ttl_tier, mock.hit_rate, mock.peak_hour, mock.overage, nowMs);
  }

  const jsonlPath = path.join(os.homedir(), '.claude', 'claude-meter.jsonl');
  const qsPath = path.join(os.homedir(), '.claude', 'quota-status.json');

  try {
    const stat = fs.statSync(jsonlPath);
    if (stat.isFile() && stat.size > 0) {
      const MAX_TAIL = 64 * 1024;
      const size = stat.size;
      const start = Math.max(0, size - MAX_TAIL);
      const len = size - start;
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(jsonlPath, 'r');
      try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
      const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        try {
          const rec = JSON.parse(lines[lines.length - 1]);
          return gate(rec.ts, rec.ttl_tier, rec.hit_rate, rec.peak_hour, rec.overage, nowMs);
        } catch {}
      }
    }
  } catch {}

  try {
    const raw = fs.readFileSync(qsPath, 'utf8');
    const qs = JSON.parse(raw);
    const cache = (qs.cache && typeof qs.cache === 'object') ? qs.cache : {};
    return gate(qs.timestamp || '', cache.ttl_tier, cache.hit_rate, qs.peak_hour, qs.overage_status, nowMs);
  } catch {
    return null;
  }
}

function gate(ts, ttl_tier, hit_rate, peak_hour, overage, nowMs) {
  const ageMs = nowMs - new Date(ts).getTime();
  if (!isFinite(ageMs) || ageMs > MAX_AGE_MS) return null;
  return {
    ttl_tier: ttl_tier || null,
    hit_rate: (hit_rate != null && hit_rate !== '' && hit_rate !== 'N/A') ? hit_rate : null,
    peak_hour: Boolean(peak_hour),
    overage: overage || '',
    ts,
  };
}

module.exports = { readMeterExtras };
