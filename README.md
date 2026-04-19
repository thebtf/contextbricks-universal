# ContextBricks Universal

[![npm version](https://img.shields.io/npm/v/contextbricks-universal.svg)](https://www.npmjs.com/package/contextbricks-universal)
[![license](https://img.shields.io/npm/l/contextbricks-universal.svg)](LICENSE)

> Cross-platform statusline for [Claude Code](https://claude.ai/code) CLI with real-time context brick visualization.

**Works on Windows, Linux, and macOS** — pure Node.js, no bash or jq required.

```
[Opus 4.7 (1m)] claude-skills:main *↑2 | +145/-23 @derailed13
[5f2ce67] Remove auth-js skill
[■■■■■■■■■■■■■□□□□□□□□□□□□□□□□□] 43% | 113k free | 0h12m | $0.87 | extra:$0.00/$20.00
session:27%/25% +0.4/m ~3h43m | week:77%/35% +1.3/hr ~4d12h | sonnet:22%/36% | design:0%/35% | TTL:1h 99.9%
```

## Features

- **Real-time context tracking** — brick visualization of context window usage
- **Unified Line 4 quotas** — session (5h) + weekly (7d) + sonnet/opus sub-limits + Claude Design, all on one line
- **Pacing target** (`/NN%`) — shows expected % for elapsed-time-in-window (green = under pace, red = ahead of pace)
- **Rate-limit merge** — Anthropic OAuth usage + [`claude-code-cache-fix`](https://www.npmjs.com/package/claude-code-cache-fix) data, cross-account safe (org-id gate)
- **Extra usage on Line 3** — monthly overage billing `extra:$N/$M` next to session cost
- **Burn rates** — `+0.4/m` (5h) / `+1.3/hr` (7d) from cache-fix data
- **TTL tier indicator** — `TTL:1h 99.9%` or red `TTL:5m ⚠ idle >5m = 800K rebuild`
- **10-step graceful degradation** — short labels (`s/w/son/des`) then drops markers → TTL → design → pacing → burn → reset → sub-limits
- **Color gradient** — 256-color green-to-red scale based on utilization percentage
- **Git integration** — repo, branch, commit hash, message, dirty/ahead/behind indicators
- **OAuth account identifier** — auto-fetched `@username` on Line 1, invalidates cache on relogin (via `.credentials.json` mtime)
- **Compact model label** — `(1M context)` shortened to `(1m)`
- **Environment config** — `CONTEXTBRICKS_SHOW_DIR`, `CONTEXTBRICKS_BRICKS`, `CONTEXTBRICKS_SHOW_LIMITS`, `CONTEXTBRICKS_SHOW_CACHE_FIX`, `CONTEXTBRICKS_USER`, `CONTEXTBRICKS_LABELS`

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

### Line 1 — Model + Git + Changes + OAuth Account

```
[Opus 4.6 (1m)] claude-skills:main *↑2 | +145/-23 @derailed13
```

Model label auto-shortens `(NM context)` → `(Nm)` (e.g. `(1M context)` → `(1m)`, `(200K context)` → `(200k)`).

The trailing `@username` is fetched from `GET /api/oauth/profile` (same OAuth token used for Line 4) and cached for 24 hours at `~/.claude/.profile-cache.json` (mode `0600`). Drops first on narrow terminals. Configure display via `CONTEXTBRICKS_USER`:

| Value | Shows |
|---|---|
| `username` (default) | `@derailed13` — local-part of email |
| `email` | `@derailed13@gmail.com` — full email |
| `name` | `@Vlad` — OAuth `display_name` (falls back to `full_name`) |
| `off` / `0` / `false` | Hidden |

### Line 2 — Commit Details

```
[5f2ce67] Remove auth-js skill
```

### Line 3 — Context Bricks + Billing

```
[■■■■■■■■■■■■■□□□□□□□□□□□□□□□□□] 43% | 113k free | 0h12m | $0.87 | extra:$0/$20
```

`extra:$N/$M` appears when the OAuth profile has extra-usage (monthly overage billing) enabled. Monthly limit is shown in USD (converted from cents).

### Line 4 — Unified Quota Line

Full render (wide terminal, cache-fix installed):

```
session:27%/25% +0.4/m ~3h43m | week:77%/35% +1.3/hr ~4d12h | sonnet:22%/36% ~4d10h | design:0%/35% | TTL:1h 99.9% | PEAK
```

Auto-merges:
- **Anthropic OAuth `/api/oauth/usage`** — authoritative source for `sonnet`/`opus` sub-limits, `design` (from the internal `seven_day_omelette` field), and `extra_usage`.
- **`claude-code-cache-fix`** via `~/.claude/claude-meter.jsonl` or `quota-status.json` — fresher per-request source for `session`/`week` utilization, burn rates, TTL tier, cache hit %, PEAK, OVERAGE.

**Cross-account safety**: when cache-fix's `anthropic-organization-id` header differs from the active OAuth profile's org, cache-fix data is dropped (prevents stale values after a relogin into a different account).

**Pacing target** (`/NN%`): expected % for elapsed-time-in-window. Coloured relative to actual usage:
- Green → more than 5% under pace (headroom)
- Dim → within ±5% of pace
- Red → more than 5% over pace (burning fast)

| Symbol | Meaning |
|--------|---------|
| `■` (cyan) | Used context |
| `□` (dim) | Free space |
| `*` | Uncommitted changes |
| `↑3` | Ahead of remote by 3 |
| `↓2` | Behind remote by 2 |
| `session:X%` | 5-hour rolling limit utilization |
| `week:X%` | 7-day overall limit utilization |
| `/NN%` (after `%`) | Pacing target (expected % based on elapsed time) |
| `+0.4/m`, `+1.3/hr` | Burn rate since window start (cache-fix only) |
| `sonnet:X%` | 7-day Sonnet sub-limit (OAuth only) |
| `opus:X%` | 7-day Opus sub-limit (OAuth only) |
| `design:X%` | 7-day Claude Design sub-limit (OAuth, from `seven_day_omelette`) |
| `~22m` / `~1d23h` | Time until limit resets (exact by default) |
| `TTL:5m` (red) / `TTL:1h` | Prompt-cache TTL tier currently served by Anthropic |
| `⚠ idle >5m = NK rebuild` | Cold-rebuild cost warning when on 5m tier |
| `NN%` (after TTL) | Cache hit rate |
| `PEAK` (yellow) | Peak-hour window |
| `OVERAGE` | Overage billing active |

**10-step graceful degradation** on narrow terminals:

1. Full labels (`session`, `week`, `sonnet`, `design`)
2. **Short labels** (`s`, `w`, `son`, `des`) — ~16 chars saved, no info loss
3. Drop `PEAK` / `OVERAGE` markers
4. Drop cache hit %
5. Drop `TTL` entirely
6. Drop `design` segment
7. Drop pacing `/NN%`
8. Drop burn rates
9. Drop reset times
10. Drop sub-limits → minimum: `s:NN% | w:NN%`

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CONTEXTBRICKS_SHOW_DIR` | `1` | Show current subdirectory (`0` to hide) |
| `CONTEXTBRICKS_BRICKS` | `30` | Number of bricks in the visualization |
| `CONTEXTBRICKS_SHOW_LIMITS` | `1` | Show rate limit line (`0` to hide) |
| `CONTEXTBRICKS_SHOW_CACHE_FIX` | `1` | Merge `claude-code-cache-fix` data into Line 4 (`0` to ignore, use OAuth only) |
| `CONTEXTBRICKS_USER` | `username` | OAuth account display on Line 1: `username` / `email` / `name` / `off` |
| `CONTEXTBRICKS_LABELS` | (auto) | Force short labels (`s/w/son/opus/des`) by setting to `short`. Default auto-degrades based on terminal width. |
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
