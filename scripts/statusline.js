#!/usr/bin/env node

// Claude Code Custom Status Line (Node.js / Cross-Platform)
// v5.0.0 — topology-aware orchestrator (rewritten from 1142 LOC inline to ~380 LOC + lib/*)
// Line 1: Model | Repo:Branch [subdir] | git status | lines changed | @user
// Line 2: [commit] commit message
// Line 3: Context bricks | percentage | free | duration | cost | extra:$N/$M
// Line 4: Unified rate-limit line — response-header probe (topology.target) is authoritative.
//         TTL+hit% prefix leads when meter data is fresh (< 30 min). PEAK/OVERAGE trail.
//
// Configuration via environment variables:
//   CONTEXTBRICKS_SHOW_DIR=1     Show current subdirectory (default: 1)
//   CONTEXTBRICKS_SHOW_DIR=0     Hide subdirectory
//   CONTEXTBRICKS_BRICKS=40      Number of bricks (default: 30)
//   CONTEXTBRICKS_SHOW_LIMITS=0  Hide rate-limit line (default: shown)
//   CONTEXTBRICKS_SHOW_CACHE_FIX=0  Disable extras (TTL / hit rate / PEAK / OVERAGE)
//   CONTEXTBRICKS_USER=username  OAuth account display: username|email|name|off (default: username)
//   CONTEXTBRICKS_LABELS=short   Force short labels (default: auto-degrade)
//   CONTEXTBRICKS_RESET_EXACT=0  Approximate reset times (default: exact)
//   CONTEXTBRICKS_RIGHT_PADDING=28  Reserve N chars on right of Line 1
//   CONTEXTBRICKS_QUOTA_PROBE_MODEL  Override probe model (skips fallback chain)
//   CONTEXTBRICKS_CACHE_PATH         Override quota cache file path (used by integration tests)
//
// See: https://code.claude.com/docs/en/statusline

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { c } = require('./lib/ansi');
const { detectTopology } = require('./lib/topology');
const { HeaderProbeQuotaSource } = require('./lib/quota-source');
const { readOAuthToken } = require('./lib/creds');
const { detectTermWidth } = require('./lib/detect-term-width');
const { buildRateView } = require('./lib/rate-view');
const { formatRateLimitLine } = require('./lib/format/rate-limit-line');
const { readMeterExtras } = require('./lib/meter-extras');

const MAX_STDIN_BYTES = 1024 * 1024;

function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(4096);
  let totalRead = 0;
  try {
    const fd = process.stdin.fd;
    while (totalRead < MAX_STDIN_BYTES) {
      try {
        const n = fs.readSync(fd, buf, 0, 4096, null);
        if (n === 0) break;
        chunks.push(Buffer.from(buf.slice(0, n)));
        totalRead += n;
      } catch { break; }
    }
  } catch {}
  return Buffer.concat(chunks).toString('utf8');
}

function resolveGitCwd(currentDir) {
  try {
    if (currentDir && fs.statSync(currentDir).isDirectory()) return currentDir;
  } catch {}
  return process.cwd();
}

function git(args, cwd, fallback = '') {
  try {
    const r = spawnSync('git', args, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: 5000, windowsHide: true, cwd });
    return (r.status === 0 && r.stdout) ? r.stdout.trim() : fallback;
  } catch { return fallback; }
}

function getPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function visibleLen(s) { return s.replace(/\x1b\[[0-9;]*m/g, '').length; }

// Profile fetch — uses topology.target for proxy compat (Open Q3 resolution, NFR-3)
// 24h disk cache + 7d stale fallback. Token via env to subprocess (FR-9).
function fetchUserProfile(token, input, topologyTarget) {
  const mock = getPath(input, '_mock_profile');
  if (mock) return mock;
  if (!token) return null;

  const cacheFile = path.join(os.homedir(), '.claude', '.profile-cache.json');
  const credsFile = path.join(os.homedir(), '.claude', '.credentials.json');
  const TTL = 24 * 3600 * 1000;
  const MAX_STALE = 7 * 24 * 3600 * 1000;
  const BACKOFF = 10 * 60 * 1000;

  let credsMtime = 0;
  try { credsMtime = fs.statSync(credsFile).mtimeMs || 0; } catch {}

  let staleData = null;
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const age = Date.now() - (cache.timestamp || 0);
    const credsChanged = credsMtime > 0 && credsMtime > (cache.timestamp || 0);
    if (age < MAX_STALE && !credsChanged) staleData = cache.data;
    if (age < TTL && !credsChanged) return cache.data;
  } catch {}

  const base = topologyTarget || 'https://api.anthropic.com';
  const script = `
    const https=require('https'),http=require('http'),url=require('url');
    const p=url.parse(process.env.PROFILE_TARGET+'/api/oauth/profile');
    const lib=p.protocol==='https:'?https:http;
    const req=lib.request({hostname:p.hostname,port:p.port||(p.protocol==='https:'?443:80),path:p.path,method:'GET',headers:{'Authorization':'Bearer '+process.env.ANTHROPIC_TOKEN,'anthropic-beta':'oauth-2025-04-20','Accept':'application/json'}},(res)=>{
      let b='',sz=0;
      res.on('data',(c)=>{sz+=c.length;if(sz>65536){req.destroy();return;}b+=c;});
      res.on('end',()=>{if(res.statusCode===200)process.stdout.write(b);});
    });
    req.on('error',()=>{});req.end();
  `;

  try {
    const r = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: 4000, windowsHide: true,
      env: { ...process.env, ANTHROPIC_TOKEN: token, PROFILE_TARGET: base },
    });
    if (r.status === 0 && r.stdout) {
      const data = JSON.parse(r.stdout);
      if (data && data.account && data.account.email) {
        try { fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), data }), { encoding: 'utf8', mode: 0o600 }); } catch {}
        return data;
      }
    }
  } catch {}

  if (staleData) {
    try { fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now() - (TTL - BACKOFF), data: staleData }), { encoding: 'utf8', mode: 0o600 }); } catch {}
  }
  return staleData;
}

function formatUserLabel(profile, format) {
  if (!profile || !profile.account) return '';
  const email = profile.account.email || '';
  const name = profile.account.display_name || profile.account.full_name || '';
  if (format === 'email') return email ? `@${email}` : '';
  if (format === 'name') return name ? `@${name}` : '';
  const local = email.includes('@') ? email.split('@')[0] : email;
  return local ? `@${local}` : (name ? `@${name}` : '');
}

function main() {
  const raw = readStdin();
  if (!raw) { process.stdout.write('ContextBricks: no input\n'); return; }

  let input;
  try { input = JSON.parse(raw); }
  catch { process.stdout.write('ContextBricks: invalid JSON\n'); return; }

  // NOTE: Claude Code footer layout bug (flexShrink=0 squeezes statusline on narrow terms).
  // Reported: https://github.com/anthropics/claude-code/issues/27864

  // Clock injectable for testing (C5: _mock_now_ms)
  const nowMs = typeof getPath(input, '_mock_now_ms') === 'number'
    ? getPath(input, '_mock_now_ms') : Date.now();

  // Topology — injectable for testing (C5: _mock_topology)
  const mockEnv = getPath(input, '_mock_topology');
  const topology = detectTopology(mockEnv || process.env, fs);

  const rawModel = (getPath(input, 'model.display_name') || 'Claude').replace('Claude ', '');
  const model = rawModel.replace(/\s*\(\s*(\d+)\s*([KMG])\s*context\s*\)/i, (_, n, u) => ` (${n}${u.toLowerCase()})`);
  const currentDir = getPath(input, 'workspace.current_dir') || process.cwd();
  const linesAdded = Number(getPath(input, 'cost.total_lines_added')) || 0;
  const linesRemoved = Number(getPath(input, 'cost.total_lines_removed')) || 0;
  const showDir = process.env.CONTEXTBRICKS_SHOW_DIR !== '0';

  const termWidth = Number(process.env.CONTEXTBRICKS_WIDTH)
    || (process.stdout.columns > 0 ? process.stdout.columns : 0)
    || (process.stderr.columns > 0 ? process.stderr.columns : 0)
    || detectTermWidth()
    || Number(process.env.COLUMNS) || 80;

  const rightPadding = (Number(process.env.CONTEXTBRICKS_RIGHT_PADDING) || 0)
    + (process.env.TERM_PROGRAM === 'vscode' ? 28 : 0);
  const totalBricks = Math.max(1, Math.min(Number(process.env.CONTEXTBRICKS_BRICKS) || 30, Math.max(5, termWidth - 35)));
  const cwd = resolveGitCwd(currentDir);

  let repoName = '', branch = '', commitShort = '', commitMsg = '';
  let gitStatus = '', subDir = '', worktreeName = '';

  const gitDir = git(['rev-parse', '--git-dir'], cwd);
  if (gitDir) {
    const toplevel = git(['rev-parse', '--show-toplevel'], cwd);
    repoName = toplevel ? path.basename(toplevel) : '';
    branch = git(['branch', '--show-current'], cwd) || 'detached';

    const commonDir = git(['rev-parse', '--git-common-dir'], cwd);
    if (commonDir) {
      const rgd = path.resolve(cwd, gitDir), rcd = path.resolve(cwd, commonDir);
      if (rgd !== rcd) { worktreeName = repoName; repoName = path.basename(path.dirname(rcd)); }
    }

    if (showDir && toplevel) {
      const rel = path.relative(toplevel, cwd).replace(/\\/g, '/');
      if (rel && rel !== '.') subDir = rel;
    }

    commitShort = git(['rev-parse', '--short', 'HEAD'], cwd);
    commitMsg = git(['log', '-1', '--pretty=format:%s'], cwd);

    if (git(['status', '--porcelain'], cwd)) gitStatus = '*';
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
    if (upstream) {
      const ahead = Number(git(['rev-list', '--count', `${upstream}..HEAD`], cwd)) || 0;
      const behind = Number(git(['rev-list', '--count', `HEAD..${upstream}`], cwd)) || 0;
      if (ahead > 0) gitStatus += `↑${ahead}`;
      if (behind > 0) gitStatus += `↓${behind}`;
    }
  }

  // Line 1 assembly
  let l1core = `${c.cyan}[${model}]${c.reset} `;
  if (repoName) {
    l1core += `${c.green}${repoName}${c.reset}`;
  } else if (showDir) {
    const home = os.homedir();
    let dp = cwd.replace(/\\/g, '/');
    const hn = home.replace(/\\/g, '/');
    if (dp.startsWith(hn)) dp = '~' + dp.slice(hn.length);
    l1core += `${c.dim}${dp}${c.reset}`;
  }

  const wtSeg = worktreeName ? `${c.dim}(wt:${worktreeName})${c.reset}` : '';
  const brSeg = (repoName && branch) ? `:${c.blue}${branch}${c.reset}` : '';
  const sdSeg = (repoName && subDir) ? ` ${c.dim}${subDir}${c.reset}` : '';
  const gsSeg = gitStatus ? ` ${c.red}${gitStatus}${c.reset}` : '';
  const dfSeg = (linesAdded > 0 || linesRemoved > 0)
    ? ` | ${c.greenNorm}+${linesAdded}${c.reset}/${c.redNorm}-${linesRemoved}${c.reset}` : '';

  const oauthToken = readOAuthToken();
  const profile = fetchUserProfile(oauthToken, input, topology.target);
  const userFormat = (process.env.CONTEXTBRICKS_USER || 'username').toLowerCase();
  const userEnabled = userFormat !== '0' && userFormat !== 'off' && userFormat !== 'false';
  const userSeg = (userEnabled && formatUserLabel(profile, userFormat))
    ? ` ${c.dim}${formatUserLabel(profile, userFormat)}${c.reset}` : '';

  function buildLine1(wt, sd, df, us) {
    return l1core + (wt ? wtSeg : '') + brSeg + (sd ? sdSeg : '') + gsSeg + (df ? dfSeg : '') + (us ? userSeg : '');
  }

  let line1 = buildLine1(true, true, true, true);
  const mw = termWidth - rightPadding;
  if (visibleLen(line1) > mw) line1 = buildLine1(true, true, true, false);
  if (visibleLen(line1) > mw) line1 = buildLine1(true, true, false, false);
  if (visibleLen(line1) > mw) line1 = buildLine1(true, false, false, false);
  if (visibleLen(line1) > mw) line1 = buildLine1(false, false, false, false);

  // Line 2
  let line2 = '';
  if (commitShort) {
    line2 = `${c.yellow}[${commitShort}]${c.reset}`;
    if (commitMsg) {
      const maxMsg = Math.max(10, termWidth - commitShort.length - 6);
      line2 += ` ${commitMsg.length > maxMsg ? commitMsg.substring(0, maxMsg) + '...' : commitMsg}`;
    }
  }

  // Line 3
  const durMs = Number(getPath(input, 'cost.total_duration_ms')) || 0;
  const durH = Math.floor(durMs / 3600000), durM = Math.floor((durMs % 3600000) / 60000);
  const cost = Number(getPath(input, 'cost.total_cost_usd')) || 0;
  const totalTok = Number(getPath(input, 'context_window.context_window_size')) || 200000;
  const usedPctRaw = getPath(input, 'context_window.used_percentage');
  const remPctRaw = getPath(input, 'context_window.remaining_percentage');

  let usagePct, usedTok, freeTok;
  if (usedPctRaw != null && usedPctRaw !== '') {
    usagePct = Math.floor(Number(usedPctRaw));
    const remPct = Math.floor(Number(remPctRaw) || (100 - usagePct));
    usedTok = Math.floor((totalTok * usagePct) / 100);
    freeTok = Math.floor((totalTok * remPct) / 100);
  } else {
    const cu = getPath(input, 'context_window.current_usage');
    usedTok = (cu && typeof cu === 'object')
      ? (Number(cu.input_tokens) || 0) + (Number(cu.cache_creation_input_tokens) || 0) + (Number(cu.cache_read_input_tokens) || 0)
      : 0;
    freeTok = totalTok - usedTok;
    usagePct = totalTok > 0 ? Math.floor((usedTok * 100) / totalTok) : 0;
  }

  const freeK = Math.floor(freeTok / 1000);
  const usedBricks = totalTok > 0 ? Math.floor((usedTok * totalBricks) / totalTok) : 0;
  const freeBricks = totalBricks - usedBricks;

  let brickLine = '[';
  for (let i = 0; i < usedBricks; i++) brickLine += `${c.cyanNorm}■${c.reset}`;
  for (let i = 0; i < freeBricks; i++) brickLine += `${c.dimWhite}□${c.reset}`;
  brickLine += `] ${c.bold}${usagePct}%${c.reset} | ${c.greenNorm}${freeK}k free${c.reset} | ${durH}h${durM}m`;
  if (cost > 0) brickLine += ` | ${c.yellowNorm}$${cost.toFixed(2)}${c.reset}`;

  // Line 4: topology-aware quota via header probe
  const showLimits = process.env.CONTEXTBRICKS_SHOW_LIMITS !== '0';
  let merged = null;

  if (showLimits) {
    const mockProbe = getPath(input, '_mock_probe_response');
    const mockLimits = getPath(input, '_mock_rate_limits');

    let quotaResult;
    if (mockLimits) {
      // Backwards compat: v4.7.0 _mock_rate_limits uses percentage-scale (0..100).
      // New QuotaData (from header parser) uses 0..1 ratio. Scale down so rate-view
      // multiplication (* 100) produces the original percentage output.
      const scale = (bucket) => {
        if (!bucket || bucket.utilization == null) return bucket;
        return { ...bucket, utilization: Number(bucket.utilization) / 100 };
      };
      const scaled = {
        five_hour: scale(mockLimits.five_hour),
        seven_day: scale(mockLimits.seven_day),
        seven_day_sonnet: scale(mockLimits.seven_day_sonnet),
        seven_day_opus: scale(mockLimits.seven_day_opus),
        seven_day_omelette: scale(mockLimits.seven_day_omelette),
        extra_usage: mockLimits.extra_usage,
      };
      quotaResult = { data: scaled, freshness: 'FRESH', age_ms: 0, source_id: 'hdr-probe' };
    } else {
      quotaResult = new HeaderProbeQuotaSource({
        topology, nowMs,
        mockProbeFn: mockProbe ? () => mockProbe : null,
        cachePath: process.env.CONTEXTBRICKS_CACHE_PATH || undefined,
      }).fetch();
    }

    const cfData = process.env.CONTEXTBRICKS_SHOW_CACHE_FIX !== '0'
      ? readMeterExtras(input, nowMs) : null;
    merged = buildRateView(quotaResult, cfData, nowMs);
  }

  // Extra usage appended to Line 3
  if (merged && merged.extra_usage && merged.extra_usage.enabled) {
    const used = (merged.extra_usage.usedCredits / 100).toFixed(2);
    const lim = (merged.extra_usage.monthlyLimit / 100).toFixed(2);
    brickLine += ` | ${c.dim}extra:${c.reset}${c.yellowNorm}$${used}/$${lim}${c.reset}`;
  }

  process.stdout.write(line1 + '\n');
  if (line2) process.stdout.write(line2 + '\n');
  process.stdout.write(brickLine + '\n');

  if (showLimits && merged) {
    const line4 = formatRateLimitLine(merged, termWidth);
    if (line4) process.stdout.write(line4 + '\n');
  }
}

main();
