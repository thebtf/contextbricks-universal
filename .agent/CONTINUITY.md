# ContextBricks Universal — Continuity

## Project State (2026-03-06)

**Version:** 4.4.0
**Branch:** main
**npm:** https://www.npmjs.com/package/contextbricks-universal
**GitHub:** https://github.com/thebtf/contextbricks-universal
**Release:** https://github.com/thebtf/contextbricks-universal/releases/tag/v4.4.0

## What This Project Does

Cross-platform Node.js statusline for Claude Code CLI. Displays 4 lines:
1. Model + git repo:branch + dirty/ahead/behind + diff stats
2. Last commit hash + message
3. Context bricks visualization + % + free tokens + session time + cost
4. Rate limit utilization (5h, 7d, sonnet, opus) with 256-color gradient + reset timers

## Architecture

- `scripts/statusline.js` — Main statusline script (~600 lines). Reads JSON from stdin (Claude Code), outputs ANSI-colored lines to stdout.
- `bin/cli.js` — CLI with install/uninstall/test/help commands (~285 lines). Copies statusline.js to ~/.claude/ and configures settings.json.
- `package.json` — npm package `contextbricks-universal`, bin aliases: `contextbricks` and `contextbricks-universal`. postinstall auto-runs install.

## Key Technical Decisions

### Git Worktree Detection (v4.2.3)
- Compares `git rev-parse --git-dir` with `--git-common-dir`
- If they differ → inside a linked worktree
- Main repo name derived from `path.dirname(resolvedCommonDir)`
- Worktree folder name saved and shown as `(wt:name)` indicator
- Display: `repoName(wt:worktreeName):branch`

### Rate Limit API
- **Endpoint:** `GET https://api.anthropic.com/api/oauth/usage`
- **Required header:** `anthropic-beta: oauth-2025-04-20` (CRITICAL — without it, 401)
- **Auth:** `Authorization: Bearer <token>` from `~/.claude/.credentials.json` (Win/Linux) or macOS keychain
- **Response fields:** `five_hour`, `seven_day`, `seven_day_sonnet`, `seven_day_opus` (nullable), `extra_usage`
- **Cache:** `~/.claude/.usage-cache.json`, TTL 15 min, max stale 5h, error backoff 3 min, mode 0o600

### Stale-While-Error Cache (v4.4.0)
- When API returns non-200 (429 rate limited, timeout): serves last cached data up to 5 hours old
- Error backoff: touches cache timestamp to prevent API hammering (3 min between retries)
- `expireResetLimits()`: zeroes out utilization when `resets_at` has passed (prevents stale high % display)
- Constants: `CACHE_TTL_MS=15min`, `MAX_STALE_MS=5h`, `ERROR_BACKOFF_MS=3min`
- Key insight: spawnSync with 429 returns exit 0 + empty stdout (not an exception) — stale fallback must be outside catch block

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
| `CONTEXTBRICKS_RIGHT_PADDING` | `0` | Reserve N chars on right of Line 1 for Claude annotations (auto-28 when TERM_PROGRAM=vscode) |

## PR Review Config

`.github/pr-review.json` — agents: coderabbit, gemini, codex

## npm Publishing

- Package name: `contextbricks-universal` (`contextbricks` is taken by jezweb's bash original)
- **Publishing goes through GitHub pipeline** (not manual npm publish)
- **Versioning:** patch changes (last digit) for minor/bug fixes; middle digit for new features

## Completed Work

1. Initial implementation (statusline + CLI + README)
2. Rate limit display (Line 4) with API discovery
3. UX iterations: `↻` → `~`, exact/approximate times, 256-color gradient, uniform label colors
4. CodeRabbit review — all 13 comments addressed
5. npm publish as `contextbricks-universal`
6. Cherry-picked Copilot improvements (process.execPath, 1MB limit)
7. Closed 4 Copilot spam PRs
8. **Git worktree detection** — shows main repo name + `(wt:name)` indicator (v4.2.3)
9. **Terminal width adaptation** — dynamic brick count + commit message truncation based on terminal width (v4.2.4)
10. **Line 1 graceful degradation** — `stripAnsi`/`visibleLen` helpers; CONTEXTBRICKS_RIGHT_PADDING + TERM_PROGRAM=vscode auto-detect (28 chars); drops diff stats → subdir → worktree when Line 1 overflows. (v4.3.0)
11. **Claude Code footer layout bug investigation** — reverse-engineered cli.js v2.1.50 renderer. Found: ink flexbox with `flexShrink:0` on right column squeezes left column. Filed GitHub issue #27864. Compact mode removed — their bug, not our fix. (v4.3.1)
12. **Stale-while-error cache** — Line 4 disappearing on API 429. TTL 5→15 min, stale fallback up to 5h, 3 min error backoff, `expireResetLimits` zeroes out past resets. Multi-model consensus (gemini thinkdeep + planner + architect + claude reviewer). (v4.4.0)

## Upstream Issues

- **#27864** (anthropics/claude-code) — Footer layout: notification bar squeezes statusline. OPEN, 0 comments.

## Lessons Learned

- `anthropic-beta: oauth-2025-04-20` header is required for OAuth usage API — not documented anywhere official
- npm on Windows removes bin entries with `./` prefix during publish — use paths without `./`
- `spawnSync` in Node.js on Windows needs explicit `windowsHide: true` to avoid console flash
- `.cjs` extension needed for hooks to avoid ESM conflicts from project-level `"type": "module"` in package.json
- **npm publishing via GitHub pipeline, not manual tokens**
- **Patch version (x.x.N) for minor changes, minor version (x.N.0) for features**
- Git worktree detection: `--git-common-dir` returns shared .git, `--git-dir` returns worktree-specific path
- **API 429 with spawnSync: exit code 0 + empty stdout, NOT an exception** — stale fallback logic must be outside catch block
