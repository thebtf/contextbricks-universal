# ContextBricks Universal — Continuity

## Project State (2026-02-07)

**Version:** 4.2.2 (published on npm)
**Branch:** main (up to date)
**npm:** https://www.npmjs.com/package/contextbricks-universal
**GitHub:** https://github.com/thebtf/contextbricks-universal
**Release:** https://github.com/thebtf/contextbricks-universal/releases/tag/v4.2.2

## What This Project Does

Cross-platform Node.js statusline for Claude Code CLI. Displays 4 lines:
1. Model + git repo:branch + dirty/ahead/behind + diff stats
2. Last commit hash + message
3. Context bricks visualization + % + free tokens + session time + cost
4. Rate limit utilization (5h, 7d, sonnet, opus) with 256-color gradient + reset timers

## Architecture

- `scripts/statusline.js` — Main statusline script (~520 lines). Reads JSON from stdin (Claude Code), outputs ANSI-colored lines to stdout.
- `bin/cli.js` — CLI with install/uninstall/test/help commands (~285 lines). Copies statusline.js to ~/.claude/ and configures settings.json.
- `package.json` — npm package `contextbricks-universal`, bin aliases: `contextbricks` and `contextbricks-universal`. postinstall auto-runs install.

## Key Technical Decisions

### Rate Limit API
- **Endpoint:** `GET https://api.anthropic.com/api/oauth/usage`
- **Required header:** `anthropic-beta: oauth-2025-04-20` (CRITICAL — without it, 401)
- **Auth:** `Authorization: Bearer <token>` from `~/.claude/.credentials.json` (Win/Linux) or macOS keychain
- **Response fields:** `five_hour`, `seven_day`, `seven_day_sonnet`, `seven_day_opus` (nullable), `extra_usage`
- **Cache:** `~/.claude/.usage-cache.json`, TTL 5 min, mode 0o600

### Sync HTTP Fetch
- `spawnSync(process.execPath, ['-e', httpsScript])` with token via `ANTHROPIC_TOKEN` env var (NOT argv — security)
- 1MB response size limit
- 4s timeout on subprocess

### Color System
- 256-color ANSI gradient: 11 stops from green(46) to red(196)
- Labels in dim white, percentages in gradient color

### Settings.json Command
- Uses `process.execPath` (absolute path to Node.js) instead of `node` for reliability

## Configuration (env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXTBRICKS_SHOW_DIR` | `1` | Show current subdirectory |
| `CONTEXTBRICKS_BRICKS` | `30` | Number of bricks |
| `CONTEXTBRICKS_SHOW_LIMITS` | `1` | Show rate limit line |
| `CONTEXTBRICKS_RESET_EXACT` | `1` | Exact reset times (`~1d23h` vs `~1d`) |

## PR Review Config

`.github/pr-review.json` — agents: coderabbit, gemini, codex

## npm Publishing

- Package name: `contextbricks-universal` (`contextbricks` is taken by jezweb's bash original)
- Auth: npm granular access token (user runs `npm login` or provides token)
- Publish: `npm publish --access public` from project root

## Completed Work

1. Initial implementation (statusline + CLI + README)
2. Rate limit display (Line 4) with API discovery
3. UX iterations: `↻` → `~`, exact/approximate times, 256-color gradient, uniform label colors
4. CodeRabbit review — all 13 comments addressed
5. npm publish as `contextbricks-universal`
6. Cherry-picked Copilot improvements (process.execPath, 1MB limit)
7. Closed 4 Copilot spam PRs

## Lessons Learned

- `anthropic-beta: oauth-2025-04-20` header is required for OAuth usage API — not documented anywhere official
- npm on Windows removes bin entries with `./` prefix during publish — use paths without `./`
- Gemini and Copilot GitHub Apps never responded to review invocations — may not be installed
- `spawnSync` in Node.js on Windows needs explicit `windowsHide: true` to avoid console flash
