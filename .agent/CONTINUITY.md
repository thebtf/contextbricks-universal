# ContextBricks Universal — Continuity

## Project State (2026-02-22)

**Version:** 4.3.1 (pushed f182360 — GitHub pipeline publishing to npm)
**Branch:** main (up to date)
**npm:** https://www.npmjs.com/package/contextbricks-universal (still shows 4.2.2 — pipeline pending)
**GitHub:** https://github.com/thebtf/contentbricks-universal
**Global install:** `npm install -g D:\Dev\contentbricks-universal` → symlinked to local, v4.3.1 active

## What This Project Does

Cross-platform Node.js statusline for Claude Code CLI. Displays 4 lines:
1. Model + git repo:branch + dirty/ahead/behind + diff stats
2. Last commit hash + message
3. Context bricks visualization + % + free tokens + session time + cost
4. Rate limit utilization (5h, 7d, sonnet, opus) with 256-color gradient + reset timers

## Architecture

- `scripts/statusline.js` — Main statusline script (~535 lines). Reads JSON from stdin (Claude Code), outputs ANSI-colored lines to stdout.
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
| `CONTEXTBRICKS_RIGHT_PADDING` | `0` | Reserve N chars on right for Claude annotations (auto-28 when TERM_PROGRAM=vscode, auto-100 when context < 15%) |

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
10. **Line 1 graceful degradation** — `stripAnsi`/`visibleLen` helpers; CONTEXTBRICKS_RIGHT_PADDING + TERM_PROGRAM=vscode auto-detect (28 chars); drops diff stats → subdir → worktree when Line 1 overflows. Fixes layout break when Claude Code injects `/ide for Visual Studio Code` or context warnings (v4.3.0)
11. **effectiveWidth for all lines + auto-compact detection** — `effectiveWidth = termWidth - rightPadding` applied to Lines 1-3 (was Line 1 only). Auto-detects "Context left until auto-compact" bar: when `context_window.remaining_percentage < 15%`, adds 100 chars to rightPadding. Fixes layout wrapping of all lines when notification appears. Commit f182360, v4.3.1 (v4.3.0)

## Fork: everything-claude-code

- **Fork:** `thebtf/everything-claude-code` at `D:\Dev\forks\everything-claude-code`
- **Goal:** improve continuous learning system based on multi-model consensus analysis
- **Insights:** `.agent/INSIGHTS.md` — v2 per-tool-call hooks are anti-pattern, v1 session-end approach is better
- **Status:** Windows compatibility already implemented by previous session; ready for commit/PR

## Lessons Learned

- `anthropic-beta: oauth-2025-04-20` header is required for OAuth usage API — not documented anywhere official
- npm on Windows removes bin entries with `./` prefix during publish — use paths without `./`
- Gemini and Copilot GitHub Apps never responded to review invocations — may not be installed
- `spawnSync` in Node.js on Windows needs explicit `windowsHide: true` to avoid console flash
- `.cjs` extension needed for hooks to avoid ESM conflicts from project-level `"type": "module"` in package.json
- **npm publishing via GitHub pipeline, not manual tokens**
- **Patch version (x.x.N) for minor changes, minor version (x.N.0) for features**
- Git worktree detection: `--git-common-dir` returns shared .git, `--git-dir` returns worktree-specific path
