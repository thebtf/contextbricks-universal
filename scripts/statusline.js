#!/usr/bin/env node

// Claude Code Custom Status Line (Node.js / Cross-Platform)
// v4.1.0 - Node.js rewrite for Windows + Linux + macOS
// Line 1: Model | Repo:Branch [subdir] | git status | lines changed
// Line 2: [commit] commit message
// Line 3: Context bricks | percentage | free | duration | cost
//
// Configuration via environment variables:
//   CONTEXTBRICKS_SHOW_DIR=1   Show current subdirectory (default: 1)
//   CONTEXTBRICKS_SHOW_DIR=0   Hide subdirectory
//   CONTEXTBRICKS_BRICKS=40    Number of bricks (default: 30)
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

  // Parse Claude data
  const model = (getPath(input, 'model.display_name') || 'Claude').replace('Claude ', '');
  const currentDir = getPath(input, 'workspace.current_dir') || process.cwd();
  const linesAdded = Number(getPath(input, 'cost.total_lines_added')) || 0;
  const linesRemoved = Number(getPath(input, 'cost.total_lines_removed')) || 0;

  // Configuration from environment variables
  const showDir = process.env.CONTEXTBRICKS_SHOW_DIR !== '0'; // default: on
  const totalBricks = Number(process.env.CONTEXTBRICKS_BRICKS) || 30;

  // Resolve working directory (no process.chdir — pass cwd to git instead)
  const cwd = resolveGitCwd(currentDir);

  // Get git information
  let repoName = '';
  let branch = '';
  let commitShort = '';
  let commitMsg = '';
  let gitStatus = '';
  let subDir = ''; // path relative to repo root

  const gitDir = git(['rev-parse', '--git-dir'], cwd);
  if (gitDir) {
    const toplevel = git(['rev-parse', '--show-toplevel'], cwd);
    repoName = toplevel ? path.basename(toplevel) : '';
    branch = git(['branch', '--show-current'], cwd) || 'detached';

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
  let line1 = '';

  // Model in brackets
  line1 += `${c.cyan}[${model}]${c.reset} `;

  // Repo:Branch + subdirectory
  if (repoName) {
    line1 += `${c.green}${repoName}${c.reset}`;
    if (branch) {
      line1 += `:${c.blue}${branch}${c.reset}`;
    }
    if (subDir) {
      line1 += ` ${c.dim}${subDir}${c.reset}`;
    }
  } else if (showDir) {
    // No git repo — show tilde-compressed path
    const home = os.homedir();
    let displayPath = cwd.replace(/\\/g, '/');
    const homeNorm = home.replace(/\\/g, '/');
    if (displayPath.startsWith(homeNorm)) {
      displayPath = '~' + displayPath.slice(homeNorm.length);
    }
    line1 += `${c.dim}${displayPath}${c.reset}`;
  }

  // Git status indicators
  if (gitStatus) {
    line1 += ` ${c.red}${gitStatus}${c.reset}`;
  }

  // Lines changed
  if (linesAdded > 0 || linesRemoved > 0) {
    line1 += ` | ${c.greenNorm}+${linesAdded}${c.reset}/${c.redNorm}-${linesRemoved}${c.reset}`;
  }

  // === Build Line 2: Commit hash + message ===
  let line2 = '';
  if (commitShort) {
    line2 += `${c.yellow}[${commitShort}]${c.reset}`;
    if (commitMsg) {
      const truncatedMsg = commitMsg.length > 55 ? commitMsg.substring(0, 55) + '...' : commitMsg;
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

main();
