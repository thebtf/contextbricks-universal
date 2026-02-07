#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const command = process.argv[2];
const STATUSLINE_SCRIPT = path.join(__dirname, '..', 'scripts', 'statusline.js');

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
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

function checkDependencies() {
  // git is optional but recommended
  const gitResult = spawnSync('git', ['--version'], { stdio: 'pipe', windowsHide: true, timeout: 5000 });
  if (gitResult.status !== 0) {
    console.warn(`${c.yellow}Warning: git not found. Git info will not be available.${c.reset}`);
  }

  console.log(`${c.green}Dependencies OK${c.reset} (Node.js ${process.version})`);
}

function backupFile(filePath) {
  if (fs.existsSync(filePath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupPath = `${filePath}.backup-${timestamp}`;
    fs.copyFileSync(filePath, backupPath);
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

  // Backup existing statusline script
  const scriptBackup = backupFile(INSTALL_PATH);
  if (scriptBackup) {
    console.log(`Backed up existing script: ${scriptBackup}`);
  }

  // Copy statusline.js
  console.log('Installing status line script...');
  if (!fs.existsSync(STATUSLINE_SCRIPT)) {
    console.error(`${c.red}Error: Source script not found: ${STATUSLINE_SCRIPT}${c.reset}`);
    process.exit(1);
  }
  fs.copyFileSync(STATUSLINE_SCRIPT, INSTALL_PATH);
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

  // Remove statusline script
  if (fs.existsSync(INSTALL_PATH)) {
    console.log('Removing status line script...');
    fs.unlinkSync(INSTALL_PATH);
    console.log(`   Removed: ${INSTALL_PATH}`);
  } else {
    console.log(`${c.yellow}Status line script not found (already removed?)${c.reset}`);
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
      if (file.startsWith('statusline.js.backup-') || file.startsWith('settings.json.backup-')) {
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
  const sampleData = JSON.stringify({
    model: { display_name: 'Sonnet 4.5' },
    workspace: { current_dir: process.cwd() },
    context_window: {
      context_window_size: 200000,
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
      five_hour: { utilization: 64.0, resets_at: new Date(now + 23 * 60000).toISOString() },
      seven_day: { utilization: 57.0, resets_at: new Date(now + 2 * 86400000).toISOString() },
      seven_day_sonnet: { utilization: 9.0, resets_at: new Date(now + 4 * 86400000).toISOString() },
      seven_day_opus: null,
    },
  });

  const result = spawnSync(process.execPath, [STATUSLINE_SCRIPT], {
    input: sampleData,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  console.log(`\n${c.dim}--- Test complete ---${c.reset}`);
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
