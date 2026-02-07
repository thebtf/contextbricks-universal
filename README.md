# ContextBricks Universal

[![npm version](https://img.shields.io/npm/v/contextbricks-universal.svg)](https://www.npmjs.com/package/contextbricks-universal)
[![license](https://img.shields.io/npm/l/contextbricks-universal.svg)](LICENSE)

> Cross-platform statusline for [Claude Code](https://claude.ai/code) CLI with real-time context brick visualization.

**Works on Windows, Linux, and macOS** — pure Node.js, no bash or jq required.

```
[Sonnet 4.5] claude-skills:main *↑2 | +145/-23
[5f2ce67] Remove auth-js skill
[■■■■■■■■■■■■■□□□□□□□□□□□□□□□□□] 43% | 113k free | 0h12m | $0.87
5h:64% ~23m | 7d:57% ~1d23h | sonnet:9% ~3d23h
```

## Features

- **Real-time context tracking** — brick visualization of context window usage
- **Rate limit tracking** — 5-hour and 7-day utilization with reset timers (Max/Pro subscribers)
- **Color gradient** — 256-color green-to-red scale based on utilization percentage
- **Official percentage fields** (Claude Code 2.1.6+) with fallback calculation (2.0.70+)
- **Git integration** — repo, branch, commit hash, message, dirty/ahead/behind indicators
- **Session metrics** — model name, lines changed, duration, cost (hidden for Max subscribers)
- **Environment config** — `CONTEXTBRICKS_SHOW_DIR`, `CONTEXTBRICKS_BRICKS`, `CONTEXTBRICKS_SHOW_LIMITS`

## Installation

### Quick Install (Recommended)

```bash
npm install -g contextbricks-universal
```

The postinstall script runs `contextbricks install` automatically.

### One-liner via npx

```bash
npx contextbricks-universal
```

### From GitHub

```bash
npm install -g github:thebtf/contextbricks-universal
```

### From Source

```bash
git clone https://github.com/thebtf/contextbricks-universal.git
cd contextbricks-universal
node bin/cli.js install
```

Node.js is the only requirement (already present if you use Claude Code).

### What the Installer Does

1. Copies `statusline.js` to `~/.claude/statusline.js`
2. Updates `~/.claude/settings.json` with the `statusLine` command
3. Backs up existing configuration before any changes

### Updating

```bash
npm update -g contextbricks-universal
contextbricks install
```

## Display Layout

### Line 1 — Model + Git + Changes

```
[Sonnet 4.5] claude-skills:main *↑2 | +145/-23
```

### Line 2 — Commit Details

```
[5f2ce67] Remove auth-js skill
```

### Line 3 — Context Bricks

```
[■■■■■■■■■■■■■□□□□□□□□□□□□□□□□□] 43% | 113k free | 0h12m | $0.87
```

### Line 4 — Rate Limits (Max/Pro subscribers)

```
5h:64% ~23m | 7d:57% ~1d23h | sonnet:9% ~3d23h
```

| Symbol | Meaning |
|--------|---------|
| `■` (cyan) | Used context |
| `□` (dim) | Free space |
| `*` | Uncommitted changes |
| `↑3` | Ahead of remote by 3 |
| `↓2` | Behind remote by 2 |
| `5h:X%` | 5-hour rolling limit utilization |
| `7d:X%` | 7-day overall limit utilization |
| `sonnet:X%` | 7-day Sonnet sub-limit (if applicable) |
| `opus:X%` | 7-day Opus sub-limit (if applicable) |
| `~22m` / `~1d23h` | Time until limit resets (exact by default) |

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CONTEXTBRICKS_SHOW_DIR` | `1` | Show current subdirectory (`0` to hide) |
| `CONTEXTBRICKS_BRICKS` | `30` | Number of bricks in the visualization |
| `CONTEXTBRICKS_SHOW_LIMITS` | `1` | Show rate limit utilization (`0` to hide) |
| `CONTEXTBRICKS_RESET_EXACT` | `1` | Exact reset times `~1d23h` (`0` for approximate `~1d`) |

## How It Works

### Context Tracking (Claude Code 2.1.6+)

Uses pre-calculated percentage fields:

```json
{
  "context_window": {
    "context_window_size": 200000,
    "used_percentage": 43.5,
    "remaining_percentage": 56.5
  }
}
```

### Fallback (Claude Code 2.0.70+)

Calculates from `current_usage` token counts when percentage fields are unavailable.

### Settings

The installer configures `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.js",
    "padding": 0
  }
}
```

## Rate Limit Tracking

Line 4 shows your current utilization of Claude's rate limits — useful for Max and Pro subscribers to avoid hitting caps.

### How It Works

1. Reads your OAuth token from Claude Code credentials (`~/.claude/.credentials.json`, or macOS keychain)
2. Fetches usage data from `api.anthropic.com/api/oauth/usage`
3. Caches the response for 5 minutes (`~/.claude/.usage-cache.json`)
4. Displays utilization percentages with 256-color gradient:
   - **Green** (0-49%) — plenty of capacity
   - **Yellow** (50-79%) — approaching limit
   - **Red** (80-100%) — near or at limit

### Requirements

- Active Claude Max or Pro subscription with OAuth credentials
- API-only users will not see Line 4 (gracefully skipped)

### Privacy

- Your OAuth token is never logged or exposed in command arguments
- Token is passed to the HTTPS subprocess via environment variable
- Cache file (`~/.claude/.usage-cache.json`) is stored locally with restricted permissions (0600)

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Line 4 not showing | Verify `~/.claude/.credentials.json` exists with `claudeAiOauth.accessToken` |
| Stale data | Delete `~/.claude/.usage-cache.json` to force refresh |
| Want to hide Line 4 | Set `CONTEXTBRICKS_SHOW_LIMITS=0` |

## Testing

```bash
contextbricks test
```

## Requirements

- **Node.js** >= 14
- **git** (optional, for git info display)

No bash, jq, bc, sed, cut, or any other Unix tools required.

## Comparison with Original

| | [contextbricks](https://www.npmjs.com/package/contextbricks) (bash) | [contextbricks-universal](https://www.npmjs.com/package/contextbricks-universal) (Node.js) |
|---|---|---|
| **Platform** | Linux/macOS only | Windows + Linux + macOS |
| **Dependencies** | bash, jq, git, bc, sed, cut | Node.js only (git optional) |
| **JSON parsing** | External `jq` | Native `JSON.parse()` |
| **Rate limits** | No | Yes (Line 4) |
| **Install** | Shell scripts | `npm i -g contextbricks-universal` |

## Uninstallation

```bash
contextbricks uninstall
```

Or manually:
1. Delete `~/.claude/statusline.js`
2. Remove the `statusLine` section from `~/.claude/settings.json`
3. Restart Claude Code

To remove the global package:
```bash
npm uninstall -g contextbricks-universal
```

## Acknowledgements

This project is a cross-platform Node.js rewrite of [ContextBricks](https://github.com/jezweb/claude-skills/tree/main/tools/statusline) created by [Jeremy Dawes](https://github.com/jezweb) ([jezweb.com.au](https://jezweb.com.au)). The original bash implementation provided the foundation for the statusline format, brick visualization, and git integration.

Also inspired by [ccstatusline](https://github.com/sirmalloc/ccstatusline).

## License

[MIT](LICENSE) — Copyright (c) 2025 Jeremy Dawes (Jezweb)
