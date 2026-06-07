#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const command = process.argv[2];
const STATUSLINE_SCRIPT = path.join(__dirname, '..', 'scripts', 'statusline.js');
const LIB_SRC = path.join(__dirname, '..', 'scripts', 'lib');

// Colors for terminal output
const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// Paths
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const INSTALL_PATH = path.join(CLAUDE_DIR, 'statusline.js');
const INSTALL_LIB_DIR = path.join(CLAUDE_DIR, 'lib');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

function checkDependencies() {
  // git is optional but recommended
  const gitResult = spawnSync('git', ['--version'], { stdio: 'pipe', windowsHide: true, timeout: 5000 });
  if (gitResult.status !== 0) {
    console.warn(`${c.yellow}Warning: git not found. Git info will not be available.${c.reset}`);
  }

  console.log(`${c.green}Dependencies OK${c.reset} (Node.js ${process.version})`);
}

// fs.lstatSync with throwIfNoEntry:false detects any file system entry,
// including broken symlinks (where fs.existsSync silently returns false).
// The try/catch handles the residual non-ENOENT errors (EACCES/EPERM) that
// throwIfNoEntry does not suppress — these would otherwise crash the
// installer with a raw stack trace.
function pathEntryExists(p) {
  try {
    return fs.lstatSync(p, { throwIfNoEntry: false }) != null;
  } catch {
    return false;
  }
}

function backupFile(filePath) {
  if (pathEntryExists(filePath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupPath = `${filePath}.backup-${timestamp}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }
  return null;
}

function backupDir(dirPath) {
  if (pathEntryExists(dirPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupPath = `${dirPath}.backup-${timestamp}`;
    fs.renameSync(dirPath, backupPath);
    return backupPath;
  }
  return null;
}

function install() {
  console.log(`\n${c.cyan}${c.bold}ContextBricks${c.reset} - Claude Code Status Line Installer\n`);

  console.log('Checking dependencies...');
  checkDependencies();
  console.log('');

  // Ensure ~/.claude exists
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    console.log(`Created: ${CLAUDE_DIR}`);
  }

  // Validate sources before touching the install destination.
  if (!fs.existsSync(STATUSLINE_SCRIPT)) {
    console.error(`${c.red}Error: Source script not found: ${STATUSLINE_SCRIPT}${c.reset}`);
    process.exit(1);
  }
  if (!fs.existsSync(LIB_SRC)) {
    console.error(`${c.red}Error: Source lib directory not found: ${LIB_SRC}${c.reset}`);
    process.exit(1);
  }

  // Install order matters: copy lib/ BEFORE statusline.js. statusline.js
  // requires its lib/ siblings; if the lib copy fails after the script
  // copy, the old script keeps loading the old lib/ instead of crashing
  // with MODULE_NOT_FOUND (which is the exact v5.0.0 defect this PR fixes).

  // Step 1 — lib/
  // backupDir + cpSync inside the same try so EBUSY / EPERM during backup
  // (Windows: locked directory) hits the friendly catch instead of a raw
  // Node stack. Rollback explicitly clears any partial INSTALL_LIB_DIR
  // before rename, since cpSync may have created the directory before
  // failing — renameSync onto a non-empty path fails on Windows.
  console.log('Installing status line modules...');
  let libBackup = null;
  try {
    libBackup = backupDir(INSTALL_LIB_DIR);
    if (libBackup) {
      console.log(`Backed up existing lib directory: ${libBackup}`);
    }
    fs.cpSync(LIB_SRC, INSTALL_LIB_DIR, { recursive: true });
  } catch (err) {
    if (libBackup) {
      try {
        if (pathEntryExists(INSTALL_LIB_DIR)) {
          fs.rmSync(INSTALL_LIB_DIR, { recursive: true, force: true });
        }
        fs.renameSync(libBackup, INSTALL_LIB_DIR);
      } catch (rollbackErr) {
        // Surface rollback failure — silently swallowing it would leave the
        // user with a corrupted install they cannot diagnose.
        console.error(`${c.red}Error: Rollback of lib directory failed: ${rollbackErr.message}${c.reset}`);
        console.error(`${c.red}   Backup preserved at: ${libBackup}${c.reset}`);
      }
    }
    console.error(`${c.red}Error: Could not install lib directory at ${INSTALL_LIB_DIR}: ${err.message}${c.reset}`);
    process.exit(1);
  }
  console.log(`   Installed: ${INSTALL_LIB_DIR}`);

  // Step 2 — statusline.js
  // Same pattern: backupFile + copyFileSync in one try. Rollback uses
  // copy (not rename — see Asymmetry note below).
  console.log('Installing status line script...');
  let scriptBackup = null;
  try {
    scriptBackup = backupFile(INSTALL_PATH);
    if (scriptBackup) {
      console.log(`Backed up existing script: ${scriptBackup}`);
    }
    fs.copyFileSync(STATUSLINE_SCRIPT, INSTALL_PATH);
  } catch (err) {
    // Rollback: restore prior statusline.js from backup. lib/ was already
    // written successfully and is forward-compatible with the prior script.
    //
    // Asymmetry note: Step 1 rollback uses rename (atomic move — backup
    // disappears in the same operation), Step 2 rollback uses copy (the
    // .backup-<ts> file remains on disk by design — leaves an audit trail
    // for a user investigating why install failed).
    if (scriptBackup) {
      try {
        fs.copyFileSync(scriptBackup, INSTALL_PATH);
      } catch (rollbackErr) {
        console.error(`${c.red}Error: Rollback of statusline script failed: ${rollbackErr.message}${c.reset}`);
        console.error(`${c.red}   Backup preserved at: ${scriptBackup}${c.reset}`);
      }
    }
    console.error(`${c.red}Error: Could not install statusline script at ${INSTALL_PATH}: ${err.message}${c.reset}`);
    process.exit(1);
  }
  console.log(`   Installed: ${INSTALL_PATH}`);
  console.log('');

  // Build the command string for settings.json
  // Use absolute path to Node.js executable for reliability across environments
  const statuslineCommand = `${process.execPath} ${INSTALL_PATH}`.replace(/\\/g, '/');

  // Update settings.json
  const settingsBackup = backupFile(SETTINGS_FILE);
  if (settingsBackup) {
    console.log(`Backed up settings: ${settingsBackup}`);
  }

  let settings = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
      console.warn(`${c.yellow}Warning: Could not parse settings.json, creating new one${c.reset}`);
    }
  }

  settings.statusLine = {
    type: 'command',
    command: statuslineCommand,
    padding: 0,
  };

  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log('   Settings updated');
  } catch (err) {
    console.error(`${c.red}Error: Could not write settings.json: ${err.message}${c.reset}`);
    process.exit(1);
  }

  console.log(`
${c.green}Installation complete!${c.reset}

${c.bold}Your status line will show:${c.reset}
   - Model name (Sonnet 4.5, Opus 4, etc.)
   - Git repo:branch [commit] message
   - Git status indicators (*uncommitted, ↑ahead, ↓behind)
   - Lines changed this session (+added/-removed)
   - Real-time context usage with brick visualization
   - Session duration and cost

${c.cyan}Restart Claude Code to see your new status line!${c.reset}

   To uninstall: contextbricks uninstall
`);
}

function uninstall() {
  console.log(`\n${c.cyan}${c.bold}ContextBricks${c.reset} - Uninstaller\n`);

  // Remove statusline script (pathEntryExists catches broken symlinks too).
  // unlinkSync wrapped in try/catch for the same reason as rmSync below:
  // an EBUSY / EPERM on Windows must not abort before settings.json cleanup.
  if (pathEntryExists(INSTALL_PATH)) {
    console.log('Removing status line script...');
    try {
      fs.unlinkSync(INSTALL_PATH);
      console.log(`   Removed: ${INSTALL_PATH}`);
    } catch (err) {
      console.warn(`${c.yellow}Warning: Could not remove statusline script: ${err.message}${c.reset}`);
      console.warn(`${c.yellow}   Continuing with settings.json cleanup — delete ${INSTALL_PATH} manually after closing Claude Code.${c.reset}`);
    }
  } else {
    console.log(`${c.yellow}Status line script not found (already removed?)${c.reset}`);
  }

  // Remove lib directory (sibling modules of statusline.js).
  //
  // Wrap rmSync in try/catch so an EBUSY / EPERM on Windows (Claude Code
  // holding a file handle on a lib/ module) does NOT abort the uninstall
  // before the settings.json cleanup below runs. Otherwise the user is
  // left with a statusLine command pointing at a removed script — Claude
  // Code then errors on every prompt.
  if (pathEntryExists(INSTALL_LIB_DIR)) {
    console.log('Removing lib directory...');
    try {
      fs.rmSync(INSTALL_LIB_DIR, { recursive: true, force: true });
      console.log(`   Removed: ${INSTALL_LIB_DIR}`);
    } catch (err) {
      console.warn(`${c.yellow}Warning: Could not fully remove lib directory: ${err.message}${c.reset}`);
      console.warn(`${c.yellow}   Continuing with settings.json cleanup — delete ${INSTALL_LIB_DIR} manually after closing Claude Code.${c.reset}`);
    }
  }

  console.log('');

  // Update settings.json - remove statusLine key
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (settings.statusLine) {
        delete settings.statusLine;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', 'utf8');
        console.log('Removed statusLine from settings.json');
      }
    } catch {
      console.warn(`${c.yellow}Warning: Could not update settings.json${c.reset}`);
    }
  }

  // List backups for manual cleanup
  const backups = [];
  try {
    const files = fs.readdirSync(CLAUDE_DIR);
    for (const file of files) {
      if (file.startsWith('statusline.js.backup-')
        || file.startsWith('settings.json.backup-')
        || file.startsWith('lib.backup-')) {
        backups.push(path.join(CLAUDE_DIR, file));
      }
    }
  } catch {
    // ignore
  }

  if (backups.length > 0) {
    console.log(`\nFound ${backups.length} backup file(s).`);
    console.log('Keeping backups (delete manually if needed):');
    for (const b of backups) {
      console.log(`   ${b}`);
    }
  }

  console.log(`\n${c.green}Uninstallation complete!${c.reset}`);
  console.log(`${c.cyan}Restart Claude Code for changes to take effect.${c.reset}\n`);
}

function showHelp() {
  console.log(`
${c.cyan}${c.bold}ContextBricks${c.reset} - Claude Code Status Line (Cross-Platform)

${c.green}Usage:${c.reset}
  contextbricks                 Install status line (default)
  contextbricks install         Install status line
  contextbricks uninstall       Uninstall status line
  contextbricks test            Test with sample data
  contextbricks --help          Show this help
  contextbricks --version       Show version

${c.green}Features:${c.reset}
  - Real-time context tracking with brick visualization
  - Git integration (repo, branch, commit, status)
  - Session metrics (duration, cost, lines changed)
  - Works on ${c.bold}Windows${c.reset}, Linux, and macOS (no bash/jq required)

${c.green}More Info:${c.reset}
  GitHub: https://github.com/thebtf/contextbricks-universal
  Issues: https://github.com/thebtf/contextbricks-universal/issues
`);
}

function test() {
  console.log(`${c.cyan}Testing statusline with sample data...${c.reset}\n`);

  const now = Date.now();

  function makeBaseData(overrides) {
    return JSON.stringify(Object.assign({
      model: { display_name: 'Claude Opus 4.6 (1M context)' },
      workspace: { current_dir: process.cwd() },
      context_window: {
        context_window_size: 1000000,
        used_percentage: 43.5,
        remaining_percentage: 56.5,
      },
      cost: {
        total_duration_ms: 765000,
        total_cost_usd: 0.87,
        total_lines_added: 145,
        total_lines_removed: 23,
      },
      _mock_rate_limits: {
        five_hour: { utilization: 27.0, resets_at: new Date(now + 3 * 3600000 + 44 * 60000).toISOString() },
        seven_day: { utilization: 45.0, resets_at: new Date(now + 4 * 86400000 + 13 * 3600000).toISOString() },
        seven_day_sonnet: { utilization: 22.0, resets_at: new Date(now + 4 * 86400000 + 11 * 3600000).toISOString() },
        seven_day_opus: null,
        seven_day_omelette: { utilization: 0.0, resets_at: new Date(now + 4 * 86400000 + 13 * 3600000).toISOString() },
        extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 0, utilization: null, currency: 'USD' },
      },
      _mock_profile: {
        account: {
          email: 'you@example.com',
          display_name: 'Tester',
          full_name: 'Test User',
          has_claude_max: true,
        },
        organization: { uuid: 'mock-org-uuid-1', organization_type: 'claude_max' },
      },
    }, overrides));
  }

  const freshTs = new Date(now).toISOString();
  const staleTs = new Date(now - 31 * 60 * 1000).toISOString();

  const variants = [
    {
      label: 'oauthOnly — no cache-fix extras',
      // Use a stale timestamp instead of null: null causes readCacheFixExtras()
      // to fall through to real filesystem (non-deterministic on machines with
      // cache-fix installed). A stale ts hits gateAndNormalize and returns null
      // deterministically regardless of filesystem state.
      data: makeBaseData({ _mock_cache_fix: { ts: staleTs } }),
    },
    {
      label: 'freshExtras — TTL/hit/PEAK suffix expected',
      data: makeBaseData({
        _mock_cache_fix: {
          ttl_tier: '1h',
          hit_rate: '99.9',
          peak_hour: false,
          overage: '',
          ts: freshTs,
        },
      }),
    },
    {
      label: 'staleExtras — staleness gate fires (31 min old), no extras suffix',
      data: makeBaseData({
        _mock_cache_fix: {
          ttl_tier: '1h',
          hit_rate: '99.9',
          peak_hour: false,
          overage: '',
          ts: staleTs,
        },
      }),
    },
    {
      label: 'staleWhileError — live OAuth 429 requires real API; in test env identical to oauthOnly',
      // Intentionally identical to oauthOnly in test env: exercising the real
      // stale-while-error path requires a live 429 response which is not
      // reproducible in offline tests. See TECHNICAL_DEBT.md.
      data: makeBaseData({ _mock_cache_fix: { ts: staleTs } }),
    },
  ];

  for (const variant of variants) {
    console.log(`${c.yellow}=== ${variant.label} ===${c.reset}`);
    const result = spawnSync(process.execPath, [STATUSLINE_SCRIPT], {
      input: variant.data,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    console.log('');
  }

  console.log(`${c.dim}--- Test complete ---${c.reset}`);
}

// Main
switch (command) {
  case 'install':
  case 'init':
    install();
    break;

  case 'uninstall':
    uninstall();
    break;

  case 'test':
    test();
    break;

  case '--version':
  case '-v': {
    const pkg = require('../package.json');
    console.log(`contextbricks-universal v${pkg.version}`);
    break;
  }

  case '--help':
  case '-h':
  case 'help':
    showHelp();
    break;

  default:
    if (command) {
      console.error(`${c.red}Unknown command: ${command}${c.reset}\n`);
      showHelp();
      process.exit(1);
    } else {
      install();
    }
}
