#!/usr/bin/env node

// Claude Code Custom Status Line (Node.js / Cross-Platform)
// v4.6.0 - Node.js rewrite for Windows + Linux + macOS
// Line 1: Model | Repo:Branch [subdir] | git status | lines changed | @user
// Line 2: [commit] commit message
// Line 3: Context bricks | percentage | free | duration | cost | extra:$N/$M
// Line 4: Unified rate-limit line — merges Anthropic OAuth usage (authoritative
//         for sub-limits + Claude Design + extra_usage) with claude-code-cache-fix
//         data (fresher 5h/7d utilization + burn rates + TTL + cache hit rate +
//         PEAK/OVERAGE). Labels: session/week/sonnet/opus/design with pacing
//         target (`/NN%`) showing expected usage for elapsed-time-in-window.
//         Cross-account safety: cache-fix data is dropped when its
//         anthropic-organization-id differs from the active OAuth profile's org.
//         Cache-fix detected via ~/.claude/claude-meter.jsonl or quota-status.json.
//
// Configuration via environment variables:
//   CONTEXTBRICKS_SHOW_DIR=1     Show current subdirectory (default: 1)
//   CONTEXTBRICKS_SHOW_DIR=0     Hide subdirectory
//   CONTEXTBRICKS_BRICKS=40      Number of bricks (default: 30)
//   CONTEXTBRICKS_SHOW_LIMITS=0  Hide rate-limit line (default: shown)
//   CONTEXTBRICKS_SHOW_CACHE_FIX=0  Ignore cache-fix data, use OAuth only (default: merge)
//   CONTEXTBRICKS_USER=username  OAuth account display: username|email|name|off (default: username)
//   CONTEXTBRICKS_LABELS=short   Force short labels (s/w/son/opus/des) (default: auto-degrade)
//   CONTEXTBRICKS_RESET_EXACT=0  Approximate reset times (default: exact)
//   CONTEXTBRICKS_RIGHT_PADDING=28  Reserve N chars on right of Line 1 for Claude annotations
//                                   (auto-set to 28 when TERM_PROGRAM=vscode)
//
// Uses new percentage fields (Claude Code 2.1.6+) for accurate context display.
// Falls back to current_usage calculation for older versions.
// See: https://code.claude.com/docs/en/statusline

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MAX_STDIN_BYTES = 1024 * 1024; // 1MB safety limit

// Read all stdin synchronously
function readStdin() {
  const chunks = [];
  const BUFSIZE = 4096;
  const buf = Buffer.alloc(BUFSIZE);
  let totalRead = 0;

  try {
    const fd = process.stdin.fd;
    while (totalRead < MAX_STDIN_BYTES) {
      try {
        const bytesRead = fs.readSync(fd, buf, 0, BUFSIZE, null);
        if (bytesRead === 0) break;
        chunks.push(Buffer.from(buf.slice(0, bytesRead)));
        totalRead += bytesRead;
      } catch {
        break; // EAGAIN or EOF
      }
    }
  } catch {
    // fd not readable
  }

  return Buffer.concat(chunks).toString('utf8');
}

// Resolve the working directory for git commands
function resolveGitCwd(currentDir) {
  try {
    if (currentDir && fs.statSync(currentDir).isDirectory()) {
      return currentDir;
    }
  } catch {
    // invalid path
  }
  return process.cwd();
}

// Run a git command using spawnSync (no shell injection possible)
function git(args, cwd, fallback = '') {
  try {
    const result = spawnSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
      cwd,
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// Safely traverse nested object path like 'a.b.c'
function getPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

// ANSI color helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[1;36m',
  green: '\x1b[1;32m',
  blue: '\x1b[1;34m',
  red: '\x1b[1;31m',
  yellow: '\x1b[1;33m',
  dimWhite: '\x1b[2;37m',
  greenNorm: '\x1b[0;32m',
  redNorm: '\x1b[0;31m',
  cyanNorm: '\x1b[0;36m',
  yellowNorm: '\x1b[0;33m',
};

// Read OAuth token from Claude Code credentials
function readOAuthToken() {
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
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const raw = fs.readFileSync(credPath, 'utf8');
    const creds = JSON.parse(raw);
    return getPath(creds, 'claudeAiOauth.accessToken') || null;
  } catch {
    return null;
  }
}

// Fetch OAuth account profile (email, display name, org) with file cache.
// Cached 24h, stale-while-error up to 7d — profile is near-static.
function fetchUserProfile(token, input) {
  // Mock data for tests
  const mockProfile = getPath(input, '_mock_profile');
  if (mockProfile) return mockProfile;

  if (!token) return null;

  const cacheFile = path.join(os.homedir(), '.claude', '.profile-cache.json');
  const credsFile = path.join(os.homedir(), '.claude', '.credentials.json');
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
  const ERROR_BACKOFF_MS = 10 * 60 * 1000; // 10min

  // Credentials mtime: used to invalidate profile cache on relogin.
  // Without this, a relogin into a different account would keep showing
  // the old @username for up to 24h.
  let credsMtimeMs = 0;
  try { credsMtimeMs = fs.statSync(credsFile).mtimeMs || 0; } catch {}

  let staleData = null;
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const age = Date.now() - (cache.timestamp || 0);
    const credsChangedAfterCache = credsMtimeMs > 0 && credsMtimeMs > (cache.timestamp || 0);
    if (age < MAX_STALE_MS && !credsChangedAfterCache) staleData = cache.data;
    if (age < CACHE_TTL_MS && !credsChangedAfterCache) return cache.data;
  } catch {
    // no cache or invalid
  }

  const httpsScript = `
    const https = require('https');
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/profile',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + process.env.ANTHROPIC_TOKEN,
        'anthropic-beta': 'oauth-2025-04-20',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      let totalSize = 0;
      const MAX_BODY = 64 * 1024;
      res.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY) { req.destroy(); return; }
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) process.stdout.write(body);
      });
    });
    req.on('error', () => {});
    req.end();
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', httpsScript], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 4000,
      windowsHide: true,
      env: { ...process.env, ANTHROPIC_TOKEN: token },
    });
    if (result.status === 0 && result.stdout) {
      const data = JSON.parse(result.stdout);
      if (data && data.account && data.account.email) {
        try {
          fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), data }), {
            encoding: 'utf8',
            mode: 0o600,
          });
        } catch {
          // cache write failure non-fatal
        }
        return data;
      }
    }
  } catch {
    // spawnSync failed
  }

  // Serve stale with error-backoff timestamp to avoid hammering
  if (staleData) {
    try {
      const backoffTs = Date.now() - (CACHE_TTL_MS - ERROR_BACKOFF_MS);
      fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: backoffTs, data: staleData }), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // ignore
    }
  }
  return staleData;
}

// Format user label based on format preference.
// Returns a string like "@derailed13" or "" when unavailable.
function formatUserLabel(profile, format) {
  if (!profile || !profile.account) return '';
  const email = profile.account.email || '';
  const name = profile.account.display_name || profile.account.full_name || '';
  switch (format) {
    case 'email':
      return email ? `@${email}` : '';
    case 'name':
      return name ? `@${name}` : '';
    case 'username':
    default: {
      const local = email.includes('@') ? email.split('@')[0] : email;
      if (local) return `@${local}`;
      return name ? `@${name}` : '';
    }
  }
}

// Zero out utilization for limits whose reset time has already passed
function expireResetLimits(data) {
  if (!data) return data;
  const now = Date.now();
  const result = { ...data };
  for (const key of ['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_opus']) {
    if (result[key] && result[key].resets_at) {
      const resetMs = new Date(result[key].resets_at).getTime();
      if (!isNaN(resetMs) && now > resetMs) {
        result[key] = { ...result[key], utilization: 0 };
      }
    }
  }
  return result;
}

// Fetch usage data from Anthropic API with file-based caching
function fetchUsageData(token, input) {
  // Check for mock data in input (test mode)
  const mockData = getPath(input, '_mock_rate_limits');
  if (mockData) return mockData;

  if (!token) return null;

  const cacheFile = path.join(os.homedir(), '.claude', '.usage-cache.json');
  // 180s matches jtbr community-reference recommendation: fresher than 15min,
  // still well under any rate-limit threshold for a single-user statusline.
  const CACHE_TTL_MS = 180 * 1000; // 3 minutes
  const MAX_STALE_MS = 5 * 60 * 60 * 1000; // 5 hours (matches Anthropic's rolling window)
  const ERROR_BACKOFF_MS = 3 * 60 * 1000; // 3 minutes

  let staleData = null;

  // Try cache first
  try {
    const cacheRaw = fs.readFileSync(cacheFile, 'utf8');
    const cache = JSON.parse(cacheRaw);
    const age = Date.now() - (cache.timestamp || 0);
    if (age < MAX_STALE_MS) {
      staleData = cache.data;
    }
    if (age < CACHE_TTL_MS) {
      return cache.data; // fresh cache
    }
  } catch {
    // no cache or invalid
  }

  // Fetch from API using sync subprocess (token via env var for security)
  const httpsScript = `
    const https = require('https');
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + process.env.ANTHROPIC_TOKEN,
        'anthropic-beta': 'oauth-2025-04-20',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      let totalSize = 0;
      const MAX_BODY_SIZE = 1024 * 1024;
      res.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) { req.destroy(); return; }
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          process.stdout.write(body);
        }
      });
    });
    req.on('error', () => {});
    req.end();
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', httpsScript], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 4000,
      windowsHide: true,
      env: { ...process.env, ANTHROPIC_TOKEN: token },
    });

    if (result.status === 0 && result.stdout) {
      const data = JSON.parse(result.stdout);
      // Only cache valid usage data (not error responses)
      if (data && (data.five_hour || data.seven_day || data.seven_day_sonnet || data.seven_day_opus)) {
        try {
          fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), data }), {
            encoding: 'utf8',
            mode: 0o600,
          });
        } catch {
          // cache write failure is non-fatal
        }
      }
      return data;
    }
  } catch {
    // spawnSync failed (timeout, spawn error)
  }

  // API failed or returned non-200: apply error backoff and return stale data
  if (staleData) {
    // Touch cache timestamp to prevent hammering (next retry in ~ERROR_BACKOFF_MS)
    try {
      const backoffTimestamp = Date.now() - (CACHE_TTL_MS - ERROR_BACKOFF_MS);
      fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: backoffTimestamp, data: staleData }), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // backoff write failure is non-fatal
    }
    return expireResetLimits(staleData);
  }

  return null;
}

// Return 256-color ANSI code for smooth green → yellow → red gradient
function getColorForUtilization(pct) {
  // 256-color: green(46) → yellow(226) → red(196), 11 stops at ~10% intervals
  const gradient = [46, 82, 118, 154, 190, 226, 220, 214, 208, 202, 196];
  const clamped = Math.max(0, Math.min(100, pct));
  const idx = Math.min(Math.round(clamped / 10), gradient.length - 1);
  return `\x1b[38;5;${gradient[idx]}m`;
}

// Format ISO reset time string to human-readable relative time
// exact=true: "1h30m", "2d5h"  |  exact=false: "1h", "2d"
function formatResetTime(isoStr, exact) {
  if (!isoStr) return '';
  try {
    const resetMs = new Date(isoStr).getTime();
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0) return '0m';

    const totalMin = Math.floor(diffMs / 60000);
    const totalHours = Math.floor(totalMin / 60);
    const remainMin = totalMin % 60;
    const days = Math.floor(totalHours / 24);
    const remainHours = totalHours % 24;

    if (!exact) {
      if (totalMin < 60) return `${totalMin}m`;
      if (totalHours < 24) return `${totalHours}h`;
      return `${days}d`;
    }

    // Exact mode: combined units
    if (totalMin < 60) return `${totalMin}m`;
    if (totalHours < 24) {
      return remainMin > 0 ? `${totalHours}h${remainMin}m` : `${totalHours}h`;
    }
    return remainHours > 0 ? `${days}d${remainHours}h` : `${days}d`;
  } catch {
    return '';
  }
}

// Compute pacing target (expected % used, based on elapsed time in window).
// Returns integer 0..100, or null if reset_at is missing/invalid.
function computePacing(resetsAtIso, windowMs, nowMs) {
  if (!resetsAtIso || !windowMs) return null;
  const resetMs = new Date(resetsAtIso).getTime();
  if (!isFinite(resetMs) || resetMs <= 0) return null;
  const windowStart = resetMs - windowMs;
  const elapsed = nowMs - windowStart;
  if (elapsed <= 0) return 0;
  const pct = Math.floor((elapsed / windowMs) * 100);
  return Math.max(0, Math.min(100, pct));
}

// Build a single rate-limit segment with pacing + burn + reset.
// Examples:
//   "session:31%/42% +0.4/m ~3h43m"  (full)
//   "s:31%/42% +0.4/m ~3h43m"        (short labels)
//   "session:31% ~3h43m"             (degraded: no pacing, no burn)
//   "session:31%"                    (minimum)
function buildLimitSegment(entry, labelFull, labelShort, opts) {
  if (!entry || entry.utilization == null) return null;
  const {
    useShort = false,
    includePacing = true,
    includeBurn = true,
    includeReset = true,
    exact = true,
  } = opts || {};
  const label = useShort ? labelShort : labelFull;
  const pct = Number(entry.utilization);
  const rounded = Math.round(pct);
  const color = getColorForUtilization(pct);

  let segment = `${c.dimWhite}${label}:${c.reset}${color}${rounded}%${c.reset}`;

  if (includePacing && entry.pacing != null) {
    // Color pacing comparison: red if over-pace (>+5%), green if under (<-5%), dim otherwise.
    const diff = rounded - entry.pacing;
    let pColor = c.dim;
    if (diff > 5) pColor = c.redNorm;
    else if (diff < -5) pColor = c.greenNorm;
    segment += `${pColor}/${entry.pacing}%${c.reset}`;
  }
  if (includeBurn && entry.burn) {
    segment += ` ${c.dim}${entry.burn}${c.reset}`;
  }
  if (includeReset) {
    const resetStr = formatResetTime(entry.resets_at, exact);
    if (resetStr) segment += ` ${c.dim}~${resetStr}${c.reset}`;
  }
  return segment;
}

// Merge OAuth usage data with claude-code-cache-fix data into a unified
// semantic structure. Cross-account safety via expectedOrgId gate.
//
// Output:
//   {
//     session: { utilization, resets_at, burn, pacing } | null,   // 5h rolling
//     week:    { utilization, resets_at, burn, pacing } | null,   // 7d rolling
//     sonnet:  { utilization, resets_at, pacing } | null,         // sub-limit
//     opus:    { utilization, resets_at, pacing } | null,         // sub-limit
//     design:  { utilization, resets_at, pacing } | null,         // seven_day_omelette
//     extras:  { ttl, hit, cacheCreation, cacheRead, peak, overage },
//     extra_usage: { usedCredits, monthlyLimit, enabled } | null,
//     cfRejected: boolean,  // true when cache-fix data was dropped for org mismatch
//   }
//
// Priority: cache-fix wins for session/week ONLY when (a) its reset is in the
// future AND (b) its org_id matches expectedOrgId (prevents cross-account leak
// after relogin). Sub-limits and design are OAuth-only.
function mergeRateData(oauthData, cfData, expectedOrgId) {
  const out = {
    session: null,
    week: null,
    sonnet: null,
    opus: null,
    design: null,
    extras: { ttl: null, hit: null, cacheCreation: 0, cacheRead: 0, peak: false, overage: '' },
    extra_usage: null,
    cfRejected: false,
  };

  // Org gate: if cfData declares a different org than the active profile,
  // reject it entirely. This catches the relogin-stale-file scenario.
  let cfUsable = cfData;
  if (cfUsable && expectedOrgId) {
    const cfOrg = (cfUsable._extras && cfUsable._extras.org_id) || '';
    if (cfOrg && cfOrg !== expectedOrgId) {
      out.cfRejected = true;
      cfUsable = null;
    }
  }

  // nowMs anchors burn-rate to when cache-fix last wrote; realNowMs gates expiry.
  const nowMs = (cfUsable && cfUsable.ts)
    ? (new Date(cfUsable.ts).getTime() || Date.now())
    : Date.now();
  const realNowMs = Date.now();

  const WINDOW_5H = 5 * 3600 * 1000;
  const WINDOW_7D = 7 * 86400 * 1000;

  // session (5h) — cache-fix preferred when reset is future
  const cf5hResetMs = cfUsable ? Number(cfUsable.q5h_reset) * 1000 : 0;
  if (cfUsable && cf5hResetMs > realNowMs) {
    const pct = Math.floor((Number(cfUsable.q5h) || 0) * 100);
    const resetsAt = new Date(cf5hResetMs).toISOString();
    let burn = '';
    if (pct > 0) {
      const windowStart = cf5hResetMs - WINDOW_5H;
      const elapsedMin = (nowMs - windowStart) / 60000;
      if (elapsedMin > 1) burn = `+${(pct / elapsedMin).toFixed(1)}/m`;
    }
    out.session = { utilization: pct, resets_at: resetsAt, burn, pacing: computePacing(resetsAt, WINDOW_5H, realNowMs) };
  } else if (oauthData && oauthData.five_hour) {
    const fh = oauthData.five_hour;
    out.session = { utilization: fh.utilization, resets_at: fh.resets_at, burn: '', pacing: computePacing(fh.resets_at, WINDOW_5H, realNowMs) };
  }

  // week (7d) — same priority
  const cf7dResetMs = cfUsable ? Number(cfUsable.q7d_reset) * 1000 : 0;
  if (cfUsable && cf7dResetMs > realNowMs) {
    const pct = Math.floor((Number(cfUsable.q7d) || 0) * 100);
    const resetsAt = new Date(cf7dResetMs).toISOString();
    let burn = '';
    if (pct > 0) {
      const windowStart = cf7dResetMs - WINDOW_7D;
      const elapsedMin = (nowMs - windowStart) / 60000;
      if (elapsedMin > 1) burn = `+${(pct / (elapsedMin / 60)).toFixed(1)}/hr`;
    }
    out.week = { utilization: pct, resets_at: resetsAt, burn, pacing: computePacing(resetsAt, WINDOW_7D, realNowMs) };
  } else if (oauthData && oauthData.seven_day) {
    const sd = oauthData.seven_day;
    out.week = { utilization: sd.utilization, resets_at: sd.resets_at, burn: '', pacing: computePacing(sd.resets_at, WINDOW_7D, realNowMs) };
  }

  // Sub-limits + design — OAuth-only (unified cache-fix headers have no per-model breakdown)
  if (oauthData) {
    if (oauthData.seven_day_sonnet) {
      const s = oauthData.seven_day_sonnet;
      out.sonnet = { utilization: s.utilization, resets_at: s.resets_at, pacing: computePacing(s.resets_at, WINDOW_7D, realNowMs) };
    }
    if (oauthData.seven_day_opus) {
      const o = oauthData.seven_day_opus;
      out.opus = { utilization: o.utilization, resets_at: o.resets_at, pacing: computePacing(o.resets_at, WINDOW_7D, realNowMs) };
    }
    // Claude Design lives under Anthropic's internal codename `seven_day_omelette`.
    // Only appears for accounts with the feature flag (claude_ai_omelette_enabled);
    // skip entries without a real reset timestamp to avoid rendering "design:0% ~NaN".
    if (oauthData.seven_day_omelette && oauthData.seven_day_omelette.resets_at) {
      const d = oauthData.seven_day_omelette;
      out.design = { utilization: d.utilization, resets_at: d.resets_at, pacing: computePacing(d.resets_at, WINDOW_7D, realNowMs) };
    }
    // Extra usage (monetary overage) — monthlyLimit is in cents.
    if (oauthData.extra_usage) {
      const eu = oauthData.extra_usage;
      out.extra_usage = {
        usedCredits: Number(eu.used_credits) || 0,
        monthlyLimit: Number(eu.monthly_limit) || 0,
        enabled: Boolean(eu.is_enabled),
      };
    }
  }

  // Cache-fix extras — regardless of whether cfData won the 5h/7d battle,
  // TTL/hit/PEAK/OVERAGE still useful IF org matches (already gated above).
  if (cfUsable) {
    const ex = cfUsable._extras || { cache: {}, peak_hour: false };
    const cache = ex.cache || {};
    out.extras.ttl = cache.ttl_tier || null;
    out.extras.hit = (cache.hit_rate != null && cache.hit_rate !== '' && cache.hit_rate !== 'N/A')
      ? cache.hit_rate
      : null;
    out.extras.cacheCreation = Number(cache.cache_creation) || 0;
    out.extras.cacheRead = Number(cache.cache_read) || 0;
    out.extras.peak = Boolean(ex.peak_hour);
    out.extras.overage = cfUsable.qoverage || '';
  }

  return out;
}

// Build the cache-fix extras tail ("| TTL:1h 98% | PEAK | OVERAGE").
// Flags control graceful degradation.
function buildExtrasTail(extras, flags) {
  if (!extras) return '';
  const { includeTTL = true, includeIdleWarning = true, includeHit = true,
    includePeak = true, includeOverage = true } = flags;
  let tail = '';

  if (extras.overage === 'active' && includeOverage) {
    tail += ' | OVERAGE';
  }

  if (extras.ttl && includeTTL) {
    if (extras.ttl === '5m') {
      tail += ` | \x1b[31mTTL:5m\x1b[0m`;
      if (includeIdleWarning) {
        const prefix = extras.cacheCreation + extras.cacheRead;
        if (prefix > 0) {
          const warn = prefix >= 1_000_000
            ? `${(prefix / 1_000_000).toFixed(1)}M`
            : `${Math.round(prefix / 1000)}K`;
          tail += ` \x1b[31m\u26A0 idle >5m = ${warn} rebuild\x1b[0m`;
        }
      }
    } else {
      tail += ` | ${c.dimWhite}TTL:${c.reset}${extras.ttl}`;
    }
    if (extras.hit && includeHit) tail += ` ${c.dim}${extras.hit}%${c.reset}`;
  }

  if (extras.peak && includePeak) {
    tail += ` | \x1b[33mPEAK\x1b[0m`;
  }

  return tail;
}

// Assemble the unified rate-limit Line 4 with 10-step graceful degradation.
// Semantic labels: session/week/sonnet/opus/design. Short-labels mode swaps
// to s/w/son/opus/des for denser terminals.
//
// Chain (widest → narrowest):
//  L0 full: session:31%/42% +0.4/m ~3h43m | week:… | sonnet:22% | design:0% | TTL:1h 99% | PEAK
//  L1 short labels (s/w/son/des): same info, ~16 chars saved
//  L2 drop PEAK/OVERAGE markers
//  L3 drop TTL hit %
//  L4 drop TTL entirely
//  L5 drop design
//  L6 drop pacing /NN%
//  L7 drop burn rates
//  L8 drop reset times
//  L9 drop sub-limits (sonnet/opus) — minimum: s:31% | w:78%
function formatRateLimitLine(merged, termWidth) {
  if (!merged) return '';
  const exact = process.env.CONTEXTBRICKS_RESET_EXACT !== '0';
  const maxWidth = Math.max(20, termWidth || 80);
  const forceShort = (process.env.CONTEXTBRICKS_LABELS || '').toLowerCase() === 'short';

  function build(opts) {
    const {
      useShort = false,
      includePacing = true,
      includeBurn = true,
      includeReset = true,
      includeSubLimits = true,
      includeDesign = true,
      includeTTL = true,
      includeIdleWarning = true,
      includeHit = true,
      includePeak = true,
      includeOverage = true,
    } = opts;

    const segOpts = { useShort, includePacing, includeBurn, includeReset, exact };

    const segs = [
      buildLimitSegment(merged.session, 'session', 's', segOpts),
      buildLimitSegment(merged.week, 'week', 'w', segOpts),
    ];
    if (includeSubLimits) {
      segs.push(buildLimitSegment(merged.sonnet, 'sonnet', 'son', { ...segOpts, includeBurn: false, includeReset: true }));
      segs.push(buildLimitSegment(merged.opus, 'opus', 'opus', { ...segOpts, includeBurn: false, includeReset: true }));
    }
    if (includeDesign) {
      segs.push(buildLimitSegment(merged.design, 'design', 'des', { ...segOpts, includeBurn: false, includeReset: false }));
    }
    let line = segs.filter(Boolean).join(' | ');
    line += buildExtrasTail(merged.extras, {
      includeTTL, includeIdleWarning, includeHit, includePeak, includeOverage,
    });
    return line;
  }

  // Degradation chain. Always honors forceShort by starting at short-labels level.
  const baseShort = forceShort;
  const fallbacks = [
    { useShort: baseShort },                                                                 // L0/L1 full (short if forced)
    { useShort: true },                                                                       // L1 short labels
    { useShort: true, includePeak: false, includeOverage: false },                            // L2 drop markers
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false },         // L3 drop hit%
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false, includeTTL: false, includeIdleWarning: false }, // L4 drop TTL
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false, includeTTL: false, includeIdleWarning: false, includeDesign: false }, // L5 drop design
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false, includeTTL: false, includeIdleWarning: false, includeDesign: false, includePacing: false }, // L6 drop pacing
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false, includeTTL: false, includeIdleWarning: false, includeDesign: false, includePacing: false, includeBurn: false }, // L7 drop burn
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false, includeTTL: false, includeIdleWarning: false, includeDesign: false, includePacing: false, includeBurn: false, includeReset: false }, // L8 drop reset
    { useShort: true, includePeak: false, includeOverage: false, includeHit: false, includeTTL: false, includeIdleWarning: false, includeDesign: false, includePacing: false, includeBurn: false, includeReset: false, includeSubLimits: false }, // L9 minimum
  ];

  let line = '';
  for (const opts of fallbacks) {
    line = build(opts);
    if (visibleLen(line) <= maxWidth) return line;
  }
  return line; // return narrowest even if still over
}

// Read extras (cache tier, hit rate, peak_hour, org_id) from quota-status.json.
// org_id is used downstream to reject cache-fix data written under a different
// OAuth account (relogin scenario where quota-status.json still reflects the
// previous account's headers).
function readQuotaStatusExtras(qsPath) {
  try {
    const raw = fs.readFileSync(qsPath, 'utf8');
    const qs = JSON.parse(raw);
    const headers = (qs && qs.all_headers && typeof qs.all_headers === 'object') ? qs.all_headers : {};
    return {
      cache: (qs && qs.cache && typeof qs.cache === 'object') ? qs.cache : {},
      peak_hour: Boolean(qs && qs.peak_hour),
      org_id: headers['anthropic-organization-id'] || '',
    };
  } catch {
    return { cache: {}, peak_hour: false, org_id: '' };
  }
}

// Detect claude-code-cache-fix / claude-code-meter output and return latest record.
// Primary source: ~/.claude/claude-meter.jsonl (last line).
// Fallback: ~/.claude/quota-status.json (written by cache-fix interceptor).
// Tests: `_mock_cache_fix` on stdin short-circuits file I/O with a deterministic
// payload matching the { q5h, q7d, q5h_reset, q7d_reset, qoverage, ts, _extras }
// shape, enabling coverage of 5m/PEAK/OVERAGE branches without a live file.
// Returns null when neither source is available — indicator stays hidden.
function readCacheFixQuota(input) {
  const mock = getPath(input, '_mock_cache_fix');
  if (mock) return mock;

  const home = os.homedir();
  const jsonlPath = path.join(home, '.claude', 'claude-meter.jsonl');
  const qsPath = path.join(home, '.claude', 'quota-status.json');

  // Primary: tail of claude-meter.jsonl
  try {
    const stat = fs.statSync(jsonlPath);
    if (stat.isFile() && stat.size > 0) {
      const MAX_TAIL = 64 * 1024;
      const size = stat.size;
      const start = Math.max(0, size - MAX_TAIL);
      const len = size - start;
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(jsonlPath, 'r');
      try {
        fs.readSync(fd, buf, 0, len, start);
      } finally {
        fs.closeSync(fd);
      }
      const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        try {
          const rec = JSON.parse(lines[lines.length - 1]);
          return { ...rec, _extras: readQuotaStatusExtras(qsPath) };
        } catch {
          // malformed last line — fall through to qs fallback
        }
      }
    }
  } catch {
    // no jsonl — fall through
  }

  // Fallback: translate quota-status.json into the same shape
  try {
    const raw = fs.readFileSync(qsPath, 'utf8');
    const qs = JSON.parse(raw);
    const fh = qs.five_hour || {};
    const sd = qs.seven_day || {};
    const headers = (qs.all_headers && typeof qs.all_headers === 'object') ? qs.all_headers : {};
    return {
      q5h: Number(fh.utilization) || 0,
      q7d: Number(sd.utilization) || 0,
      q5h_reset: Number(fh.resets_at) || 0,
      q7d_reset: Number(sd.resets_at) || 0,
      qoverage: qs.overage_status || '',
      ts: qs.timestamp || '',
      _extras: {
        cache: (qs.cache && typeof qs.cache === 'object') ? qs.cache : {},
        peak_hour: Boolean(qs.peak_hour),
        org_id: headers['anthropic-organization-id'] || '',
      },
    };
  } catch {
    return null;
  }
}

// Strip ANSI escape codes to measure visible string length
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLen(s) {
  return stripAnsi(s).length;
}

function main() {
  // Read JSON from stdin
  const raw = readStdin();
  if (!raw) {
    process.stdout.write('ContextBricks: no input\n');
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write('ContextBricks: invalid JSON\n');
    return;
  }

  // NOTE: Claude Code's footer layout has a bug where the right column (notifications)
  // uses flexShrink=0 and can squeeze the left column (statusline) on narrow terminals.
  // Reported: https://github.com/anthropics/claude-code/issues/27864
  // We always output full statusline — layout issues are Claude Code's responsibility.

  // Parse Claude data
  // Shorten "(1M context)" / "(200K context)" → "(1m)" / "(200k)" for compactness
  const rawModel = (getPath(input, 'model.display_name') || 'Claude').replace('Claude ', '');
  const model = rawModel.replace(
    /\s*\(\s*(\d+)\s*([KMG])\s*context\s*\)/i,
    (_, n, unit) => ` (${n}${unit.toLowerCase()})`,
  );
  const currentDir = getPath(input, 'workspace.current_dir') || process.cwd();
  const linesAdded = Number(getPath(input, 'cost.total_lines_added')) || 0;
  const linesRemoved = Number(getPath(input, 'cost.total_lines_removed')) || 0;

  // Configuration from environment variables
  const showDir = process.env.CONTEXTBRICKS_SHOW_DIR !== '0'; // default: on

  // Terminal width for dynamic content sizing (stdout is piped, so columns may be 0/undefined)
  const termWidth = Number(process.env.CONTEXTBRICKS_WIDTH)
    || (process.stdout.columns > 0 ? process.stdout.columns : 0)
    || Number(process.env.COLUMNS)
    || 80;

  // Right-padding: reserve space for Claude Code's right-aligned injections on Line 1
  // e.g. "/ide for Visual Studio Code" (27 chars + 1 separator = 28)
  const basePadding = Number(process.env.CONTEXTBRICKS_RIGHT_PADDING) || 0;
  const isVSCode = process.env.TERM_PROGRAM === 'vscode';
  const rightPadding = basePadding + (isVSCode ? 28 : 0);

  // Reserve ~35 chars for bricks stats (" 78% | 44k free | 1h5m | $12.90")
  const maxAutoBricks = Math.max(5, termWidth - 35);
  const totalBricks = Math.max(1, Math.min(
    Number(process.env.CONTEXTBRICKS_BRICKS) || 30,
    maxAutoBricks
  ));

  // Resolve working directory (no process.chdir — pass cwd to git instead)
  const cwd = resolveGitCwd(currentDir);

  // Get git information
  let repoName = '';
  let branch = '';
  let commitShort = '';
  let commitMsg = '';
  let gitStatus = '';
  let subDir = ''; // path relative to repo root

  let worktreeName = ''; // non-empty when inside a linked worktree

  const gitDir = git(['rev-parse', '--git-dir'], cwd);
  if (gitDir) {
    const toplevel = git(['rev-parse', '--show-toplevel'], cwd);
    repoName = toplevel ? path.basename(toplevel) : '';
    branch = git(['branch', '--show-current'], cwd) || 'detached';

    // Detect git worktree: --git-dir differs from --git-common-dir
    const commonDir = git(['rev-parse', '--git-common-dir'], cwd);
    if (commonDir) {
      const resolvedGitDir = path.resolve(cwd, gitDir);
      const resolvedCommonDir = path.resolve(cwd, commonDir);
      if (resolvedGitDir !== resolvedCommonDir) {
        worktreeName = repoName; // current folder is the worktree name
        // Main repo name from the parent of .git common dir
        repoName = path.basename(path.dirname(resolvedCommonDir));
      }
    }

    // Compute subdirectory relative to repo root
    if (showDir && toplevel) {
      const rel = path.relative(toplevel, cwd).replace(/\\/g, '/');
      if (rel && rel !== '.') {
        subDir = rel;
      }
    }
    commitShort = git(['rev-parse', '--short', 'HEAD'], cwd);

    // Fetch commit message once, reuse for both lines
    commitMsg = git(['log', '-1', '--pretty=format:%s'], cwd);

    // Git status indicators
    const porcelain = git(['status', '--porcelain'], cwd);
    if (porcelain) {
      gitStatus = '*';
    }

    // Check ahead/behind remote
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
    if (upstream) {
      const ahead = Number(git(['rev-list', '--count', `${upstream}..HEAD`], cwd)) || 0;
      const behind = Number(git(['rev-list', '--count', `HEAD..${upstream}`], cwd)) || 0;
      if (ahead > 0) gitStatus += `\u2191${ahead}`;
      if (behind > 0) gitStatus += `\u2193${behind}`;
    }
  }

  // === Build Line 1: Model + Repo:Branch + Status + Changes ===
  // Build optional segments separately for graceful degradation when
  // Claude Code injects right-aligned text on the same terminal row.

  // Core (always shown): [model] repo:branch * git-status
  let line1Core = '';
  line1Core += `${c.cyan}[${model}]${c.reset} `;
  if (repoName) {
    line1Core += `${c.green}${repoName}${c.reset}`;
  } else if (showDir) {
    const home = os.homedir();
    let displayPath = cwd.replace(/\\/g, '/');
    const homeNorm = home.replace(/\\/g, '/');
    if (displayPath.startsWith(homeNorm)) {
      displayPath = '~' + displayPath.slice(homeNorm.length);
    }
    line1Core += `${c.dim}${displayPath}${c.reset}`;
  }

  // Optional: worktree name
  const worktreeSegment = worktreeName ? `${c.dim}(wt:${worktreeName})${c.reset}` : '';

  // Branch (part of core when repo exists)
  const branchSegment = (repoName && branch) ? `:${c.blue}${branch}${c.reset}` : '';

  // Optional: subdirectory
  const subdirSegment = (repoName && subDir) ? ` ${c.dim}${subDir}${c.reset}` : '';

  // Git status (part of core)
  const gitStatusSegment = gitStatus ? ` ${c.red}${gitStatus}${c.reset}` : '';

  // Optional: diff stats
  const diffSegment = (linesAdded > 0 || linesRemoved > 0)
    ? ` | ${c.greenNorm}+${linesAdded}${c.reset}/${c.redNorm}-${linesRemoved}${c.reset}`
    : '';

  // Read OAuth token once — reused for profile (Line 1 tail) and usage (Line 4).
  const oauthToken = readOAuthToken();

  // Fetch profile once (used for both the @username tail and the org-gate that
  // rejects cross-account cache-fix data on Line 4).
  const profile = fetchUserProfile(oauthToken, input);
  const expectedOrgId = getPath(profile, 'organization.uuid') || '';

  // Optional: OAuth account identifier (rightmost segment, drops first on overflow)
  const userFormat = (process.env.CONTEXTBRICKS_USER || 'username').toLowerCase();
  const userEnabled = userFormat !== '0' && userFormat !== 'off' && userFormat !== 'false';
  let userSegment = '';
  if (userEnabled) {
    const label = formatUserLabel(profile, userFormat);
    if (label) userSegment = ` ${c.dim}${label}${c.reset}`;
  }

  // Build Line 1 with graceful degradation
  function buildLine1(includeWorktree, includeSubdir, includeDiff, includeUser) {
    let s = line1Core;
    if (includeWorktree) s += worktreeSegment;
    s += branchSegment;
    if (includeSubdir) s += subdirSegment;
    s += gitStatusSegment;
    if (includeDiff) s += diffSegment;
    if (includeUser) s += userSegment;
    return s;
  }

  let line1 = buildLine1(true, true, true, true);
  const maxWidth = termWidth - rightPadding;
  if (visibleLen(line1) > maxWidth) {
    line1 = buildLine1(true, true, true, false);  // drop user
  }
  if (visibleLen(line1) > maxWidth) {
    line1 = buildLine1(true, true, false, false); // drop diff
  }
  if (visibleLen(line1) > maxWidth) {
    line1 = buildLine1(true, false, false, false); // drop subdir
  }
  if (visibleLen(line1) > maxWidth) {
    line1 = buildLine1(false, false, false, false); // drop worktree
  }

  // === Build Line 2: Commit hash + message ===
  let line2 = '';
  if (commitShort) {
    line2 += `${c.yellow}[${commitShort}]${c.reset}`;
    if (commitMsg) {
      const hashPrefixLen = commitShort ? commitShort.length + 3 : 0; // "[hash] "
      const maxMsgLen = Math.max(10, termWidth - hashPrefixLen - 3); // 3 for "..."
      const truncatedMsg = commitMsg.length > maxMsgLen ? commitMsg.substring(0, maxMsgLen) + '...' : commitMsg;
      line2 += ` ${truncatedMsg}`;
    }
  }

  // === Build Line 3: Context bricks + session info ===

  // Session duration
  const durationMs = Number(getPath(input, 'cost.total_duration_ms')) || 0;
  const durationHours = Math.floor(durationMs / 3600000);
  const durationMin = Math.floor((durationMs % 3600000) / 60000);

  // Session cost
  const costUsd = Number(getPath(input, 'cost.total_cost_usd')) || 0;

  // Context window data
  const totalTokens = Number(getPath(input, 'context_window.context_window_size')) || 200000;

  // Try new percentage fields first (Claude Code 2.1.6+)
  const usedPctRaw = getPath(input, 'context_window.used_percentage');
  const remainingPctRaw = getPath(input, 'context_window.remaining_percentage');

  let usagePct, usedTokens, freeTokens;

  if (usedPctRaw != null && usedPctRaw !== '') {
    // Use official percentage (more accurate)
    usagePct = Math.floor(Number(usedPctRaw));
    const remainingPct = Math.floor(Number(remainingPctRaw) || (100 - usagePct));
    usedTokens = Math.floor((totalTokens * usagePct) / 100);
    freeTokens = Math.floor((totalTokens * remainingPct) / 100);
  } else {
    // Fallback: Calculate from current_usage (Claude Code 2.0.70+)
    const currentUsage = getPath(input, 'context_window.current_usage');

    if (currentUsage && typeof currentUsage === 'object') {
      const inputTokens = Number(currentUsage.input_tokens) || 0;
      const cacheCreation = Number(currentUsage.cache_creation_input_tokens) || 0;
      const cacheRead = Number(currentUsage.cache_read_input_tokens) || 0;
      usedTokens = inputTokens + cacheCreation + cacheRead;
    } else {
      usedTokens = 0;
    }

    freeTokens = totalTokens - usedTokens;
    usagePct = totalTokens > 0 ? Math.floor((usedTokens * 100) / totalTokens) : 0;
  }

  // Convert to 'k' format
  const freeK = Math.floor(freeTokens / 1000);

  // Generate brick visualization
  const usedBricks = totalTokens > 0 ? Math.floor((usedTokens * totalBricks) / totalTokens) : 0;
  const freeBricks = totalBricks - usedBricks;

  // Build brick line
  let brickLine = '[';

  // Used bricks (cyan)
  for (let i = 0; i < usedBricks; i++) {
    brickLine += `${c.cyanNorm}\u25A0${c.reset}`;
  }

  // Free bricks (dim/gray hollow squares)
  for (let i = 0; i < freeBricks; i++) {
    brickLine += `${c.dimWhite}\u25A1${c.reset}`;
  }

  brickLine += ']';

  // Compact stats
  brickLine += ` ${c.bold}${usagePct}%${c.reset}`;
  brickLine += ` | ${c.greenNorm}${freeK}k free${c.reset}`;
  brickLine += ` | ${durationHours}h${durationMin}m`;

  // Cost (only if non-zero)
  if (costUsd > 0) {
    const costFormatted = costUsd.toFixed(2);
    brickLine += ` | ${c.yellowNorm}$${costFormatted}${c.reset}`;
  }

  // Fetch rate-limit data early so we can append extra_usage to Line 3 (billing
  // stays with cost), AND render Line 4 below.
  const showLimits = process.env.CONTEXTBRICKS_SHOW_LIMITS !== '0';
  let merged = null;
  if (showLimits) {
    const oauthData = fetchUsageData(oauthToken, input);
    const useCacheFix = process.env.CONTEXTBRICKS_SHOW_CACHE_FIX !== '0';
    const cfData = useCacheFix ? readCacheFixQuota(input) : null;
    merged = mergeRateData(oauthData, cfData, expectedOrgId);
  }

  // Extra usage (monthly overage) on Line 3 — billing info next to session cost.
  // Graceful degradation: if Line 3 would overflow, drop extra first (handled by
  // the caller). For now append unconditionally; fine-grained width handling is
  // for a later pass if it becomes a problem in practice.
  if (merged && merged.extra_usage && merged.extra_usage.enabled) {
    const used = (merged.extra_usage.usedCredits / 100).toFixed(0);
    const limit = (merged.extra_usage.monthlyLimit / 100).toFixed(0);
    brickLine += ` | ${c.dim}extra:${c.reset}${c.yellowNorm}$${used}/$${limit}${c.reset}`;
  }

  // Output all lines
  process.stdout.write(line1 + '\n');
  if (line2) {
    process.stdout.write(line2 + '\n');
  }
  process.stdout.write(brickLine + '\n');

  // Line 4: Unified rate-limit line (OAuth + cache-fix merge)
  if (showLimits && merged) {
    const line4 = formatRateLimitLine(merged, termWidth);
    if (line4) {
      process.stdout.write(line4 + '\n');
    }
  }
}

main();
