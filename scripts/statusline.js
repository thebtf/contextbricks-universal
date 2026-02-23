#!/usr/bin/env node

// Claude Code Custom Status Line (Node.js / Cross-Platform)
// v4.3.0 - Node.js rewrite for Windows + Linux + macOS
// Line 1: Model | Repo:Branch [subdir] | git status | lines changed
// Line 2: [commit] commit message
// Line 3: Context bricks | percentage | free | duration | cost
// Line 4: Rate limit utilization (5h, 7d Sonnet, 7d Opus) — Max/Pro subscribers
//
// Configuration via environment variables:
//   CONTEXTBRICKS_SHOW_DIR=1   Show current subdirectory (default: 1)
//   CONTEXTBRICKS_SHOW_DIR=0   Hide subdirectory
//   CONTEXTBRICKS_BRICKS=40    Number of bricks (default: 30)
//   CONTEXTBRICKS_SHOW_LIMITS=0 Hide rate limit line (default: shown)
//   CONTEXTBRICKS_RESET_EXACT=0 Approximate reset times (default: exact)
//   CONTEXTBRICKS_RIGHT_PADDING=28 Reserve N chars on right of Line 1 for Claude annotations
//                                  (auto-set to 28 when TERM_PROGRAM=vscode)
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

// Fetch usage data from Anthropic API with file-based caching
function fetchUsageData(token, input) {
  // Check for mock data in input (test mode)
  const mockData = getPath(input, '_mock_rate_limits');
  if (mockData) return mockData;

  if (!token) return null;

  const cacheFile = path.join(os.homedir(), '.claude', '.usage-cache.json');
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Try cache first
  try {
    const cacheRaw = fs.readFileSync(cacheFile, 'utf8');
    const cache = JSON.parse(cacheRaw);
    if (cache.timestamp && (Date.now() - cache.timestamp) < CACHE_TTL_MS) {
      return cache.data;
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
    // API call failed — try stale cache
    try {
      const cacheRaw = fs.readFileSync(cacheFile, 'utf8');
      const cache = JSON.parse(cacheRaw);
      if (cache.data) return cache.data;
    } catch {
      // no stale cache
    }
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

// Build a single rate limit segment like "5h:23% ~1h30m"
function buildLimitSegment(data, key, label, exact) {
  const pct = getPath(data, `${key}.utilization`);
  if (pct == null) return null;
  const color = getColorForUtilization(pct);
  const resetStr = formatResetTime(getPath(data, `${key}.resets_at`), exact);
  let segment = `${c.dimWhite}${label}:${c.reset}${color}${Math.round(pct)}%${c.reset}`;
  if (resetStr) segment += ` ${c.dim}~${resetStr}${c.reset}`;
  return segment;
}

// Assemble rate limit Line 4 from usage data
function formatRateLimitLine(data) {
  if (!data) return '';
  const exact = process.env.CONTEXTBRICKS_RESET_EXACT !== '0'; // default: exact
  const segments = [
    buildLimitSegment(data, 'five_hour', '5h', exact),
    buildLimitSegment(data, 'seven_day', '7d', exact),
    buildLimitSegment(data, 'seven_day_sonnet', 'sonnet', exact),
    buildLimitSegment(data, 'seven_day_opus', 'opus', exact),
  ].filter(Boolean);
  return segments.length > 0 ? segments.join(' | ') : '';
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
  const model = (getPath(input, 'model.display_name') || 'Claude').replace('Claude ', '');
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

  // Build Line 1 with graceful degradation
  function buildLine1(includeWorktree, includeSubdir, includeDiff) {
    let s = line1Core;
    if (includeWorktree) s += worktreeSegment;
    s += branchSegment;
    if (includeSubdir) s += subdirSegment;
    s += gitStatusSegment;
    if (includeDiff) s += diffSegment;
    return s;
  }

  let line1 = buildLine1(true, true, true);
  const maxWidth = termWidth - rightPadding;
  if (visibleLen(line1) > maxWidth) {
    if (visibleLen(line1) > maxWidth) {
      line1 = buildLine1(true, true, false);   // drop diff
    }
    if (visibleLen(line1) > maxWidth) {
      line1 = buildLine1(true, false, false);  // drop subdir
    }
    if (visibleLen(line1) > maxWidth) {
      line1 = buildLine1(false, false, false); // drop worktree
    }
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

  // Output all lines
  process.stdout.write(line1 + '\n');
  if (line2) {
    process.stdout.write(line2 + '\n');
  }
  process.stdout.write(brickLine + '\n');

  // Line 4: Rate limit utilization
  const showLimits = process.env.CONTEXTBRICKS_SHOW_LIMITS !== '0';
  if (showLimits) {
    const token = readOAuthToken();
    const usageData = fetchUsageData(token, input);
    const line4 = formatRateLimitLine(usageData);
    if (line4) {
      process.stdout.write(line4 + '\n');
    }
  }
}

main();
