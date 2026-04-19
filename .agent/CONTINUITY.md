# ContextBricks Universal — Continuity

## Project State (2026-04-19)

**Version:** 4.6.0 (released, published to npm with OIDC provenance)
**Branch:** main (HEAD = 86f27b0 ci: Node 24 for Trusted Publishing)
**npm:** https://www.npmjs.com/package/contextbricks-universal (**4.6.0** published with SLSA provenance attestation)
**GitHub:** https://github.com/thebtf/contextbricks-universal
**Latest release tag:** v4.6.0 (re-tagged at 85a5f7d to include publish workflow)

## Done (v4.6.0 release cycle, 2026-04-19)

- Unified Line 4 quota redesign: session / week / sonnet / opus / design + pacing targets + 10-step graceful degradation with short labels
- Extra usage billing on Line 3 (gated on OAuth `is_enabled:true`)
- Bug fixes: cross-account cache-fix leak (org-id gate, fail-closed), profile cache invalidation on relogin, usage cache TTL 15min→180s
- Username scrubbed from all public surfaces: README, source comments, PR #7 body, v4.5.0 release notes (GitHub), force-pushed commit history
- npm Trusted Publishing via GitHub Actions OIDC (no NPM_TOKEN). Setup: trusted publisher registered on npmjs.com, `.github/workflows/publish.yml` on main, `npm-publish` environment created.
- 13 PRs merged today (#7 through #13, with 3 iterations to debug publish workflow: Run #1 404 auth, Run #2 npm self-upgrade bug, Run #3 Node 24 → success)

## Now

Nothing in flight. Session at natural checkpoint — v4.6.0 shipped end-to-end (GH tag + GH release + npm with provenance).

## Next (when resuming)

- Verify `Built and signed on GitHub Actions` badge renders on https://www.npmjs.com/package/contextbricks-universal after npm cache refreshes.
- First real-world post-release validation: on the next bump (v4.6.1 / v4.7.0), confirm the auto-publish workflow still succeeds end-to-end without manual intervention.
- Optionally scan engram observations for residual username traces if user returns with follow-up on OPSEC concern (earlier session had `derailed13` in prior memories — local-only, but removable with `delete_memory` + bulk-mark-superseded).

## Blockers

None.

## Deferred / Open (carried forward)

- **Test fixture expansion**: `_mock_cache_fix` covers TTL:1h + hit rate + burn rate. TTL:5m red branch + `⚠ idle >Nm rebuild` warning + PEAK (yellow) + OVERAGE marker still only verified by code review, not by automated mock test. Add dedicated fixture variants to `bin/cli.js test` to exercise all branches deterministically.
- **git author-email history**: if `derailed13@gmail.com` was ever configured as `git config user.email`, it's in every historical commit's `%ae` field. Not addressed this session (would require `git filter-repo` + force-push of ALL refs, breaks every clone/fork). Flagged to user at force-push time, user chose force-push of offending commit-body only.
- **Recurring CR re-review retro-fix**: PR #11 had CodeRabbit in "review in progress" at merge time. If CR eventually posts actionable findings on the now-merged workflow, handle as retro-fix PR.

## Resumability Test

A future agent running `/session --load` on this CONTINUITY.md should, in the first 5 actions:

1. Read this file → see v4.6.0 shipped, no in-flight work, next step is "verify badge" or "next release".
2. Run `npm view contextbricks-universal version` → confirm `4.6.0` (or higher if another release shipped).
3. Run `git log --oneline -5` → see `4065b78 docs(continuity) → 86f27b0 ci: Node 24 → 514f488 npm upgrade → f3ef05e publish workflow → c766d8a username scrub`.
4. Run `gh run list --workflow publish.yml --limit 3` → confirm latest run was `success`.
5. Run `gh release view v4.6.0 --json tagName,name,publishedAt,url` → confirm release is live with correct tag.

All context needed to resume is encoded in this file + git + GitHub + npm. No tribal knowledge required.

## What This Project Does

Cross-platform Node.js statusline for Claude Code CLI. Displays 4 lines:
1. Model + git repo:branch + dirty/ahead/behind + diff stats
2. Last commit hash + message
3. Context bricks visualization + % + free tokens + session time + cost
4. **Unified rate-limit line**: merges Anthropic OAuth usage (authoritative for `sonnet`/`opus` sub-limits) with `claude-code-cache-fix` data (fresher source for 5h/7d utilization, burn rates `+0.2/m`/`+1.7/hr`, TTL tier, cache hit rate, PEAK, OVERAGE). Cache-fix data takes priority for 5h/7d when both sources are present. Graceful degradation on narrow terminals.

## Architecture

- `scripts/statusline.js` — Main statusline script (~600 lines). Reads JSON from stdin (Claude Code), outputs ANSI-colored lines to stdout.
- `bin/cli.js` — CLI with install/uninstall/test/help commands (~285 lines). Copies statusline.js to ~/.claude/ and configures settings.json.
- `package.json` — npm package `contextbricks-universal`, bin aliases: `contextbricks` and `contextbricks-universal`. postinstall auto-runs install.

## Key Technical Decisions

### Unified Rate-Limit Line — OAuth + cache-fix merge (v4.5.0)
- **Two sources, one line**: replaced the initial separate Line 5 design after realizing Q5h/Q7d duplicate Line 4's 5h/7d (same Anthropic `anthropic-ratelimit-unified-{5h,7d}-utilization` headers under different labels). User feedback drove this refactor.
- **Priority resolution in `mergeRateData(oauthData, cfData)`**:
  - 5h / 7d utilization + reset: cache-fix wins when `q5h_reset`/`q7d_reset > 0`, else OAuth. Cache-fix is fresher (per-request header read) vs. OAuth's 15-min poll + stale-while-error window.
  - `sonnet` / `opus` sub-limits: **OAuth only** — unified cache-fix headers have no per-model breakdown. OAuth still fetched even when cache-fix is present.
  - `TTL`, hit rate, `PEAK`, `OVERAGE`, burn rates: cache-fix only.
- **Burn rates** (cache-fix only, requires reset timestamp):
  - 5h: `+%/m = pct / elapsed_min` since window_start (`reset - 5h`)
  - 7d: `+%/hr = pct / (elapsed_min / 60)` since window_start (`reset - 7d`)
  - Suppressed when `elapsed_min ≤ 1` or `pct ≤ 0` (avoids division noise at window boundary)
- **Source files** (same as before the merge):
  - Primary: `~/.claude/claude-meter.jsonl` (last line, tailed to 64KB)
  - Fallback: `~/.claude/quota-status.json` (cache-fix interceptor writes per request)
  - Port-of-logic: `C:\Users\btf\AppData\Roaming\npm\node_modules\claude-code-cache-fix\tools\quota-statusline.sh`
- **Graceful degradation chain** (widest → narrowest, by terminal width):
  1. Full: `5h:X% +burn ~reset | 7d:X% +burn ~reset | sonnet:X% | opus:X% | ⚠ idle warning | TTL:1h NN% | PEAK | OVERAGE`
  2. Drop idle-warning text
  3. Drop cache hit rate (`NN%`)
  4. Drop burn rates (`+0.2/m`, `+1.7/hr`)
  5. Drop `PEAK` marker
  6. Drop `OVERAGE` marker
  7. Drop `TTL` extras
  8. Drop sub-limits (`sonnet`, `opus`)
  - Minimum always shown: `5h:X% | 7d:X%` (whichever source is available)
- **Coloring preserved from bash source 1:1**: red `\x1b[31m` for `TTL:5m` + idle warning, yellow `\x1b[33m` for `PEAK`, plain text for `OVERAGE`, OAuth 256-color gradient for utilization percentages.
- **Env toggles:**
  - `CONTEXTBRICKS_SHOW_LIMITS=0` → hide entire Line 4 (existing)
  - `CONTEXTBRICKS_SHOW_CACHE_FIX=0` → ignore cache-fix data, fall back to pure OAuth (new semantics — was "hide Line 5" before the merge)
- **No Line 5** — merged into Line 4; eliminates the prior Q5h/Q7d duplication.
- **Formatting parity with Python:** `Math.floor(x * 100)` matches `int(x * 100)` for non-negative utilization; `+` sign always prefixed for positive rates.

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
| `CONTEXTBRICKS_SHOW_CACHE_FIX` | `1` | Merge `claude-code-cache-fix` data into Line 4 (`0` → ignore, use OAuth only). Line 5 was removed in v4.5.0. |
| `CONTEXTBRICKS_RESET_EXACT` | `1` | Exact reset times (`~1d23h` vs `~1d`) |
| `CONTEXTBRICKS_RIGHT_PADDING` | `0` | Reserve N chars on right of Line 1 for Claude annotations (auto-28 when TERM_PROGRAM=vscode) |

## PR Review Config

`.github/pr-review.json` — agents: coderabbit, gemini, codex

## npm Publishing

- Package name: `contextbricks-universal` (`contextbricks` is taken by jezweb's bash original)
- **Release state (verified 2026-04-16):** no `.github/workflows/` — there is NO auto-publish pipeline. Previous note claiming "publishing through GitHub pipeline" was incorrect; `gh release create` has been run manually but `npm publish` has NOT been run since `v4.2.2` (npm latest = `4.2.2` while GH releases go up to `v4.4.0`).
- **Consequence:** npm users are stuck two minor versions behind GH releases. Publishing `v4.5.0` to npm requires a manual `npm publish` with owner credentials, OR adding a `.github/workflows/release.yml` that triggers on tag push.
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
13. **claude-code-cache-fix Line 5** (initial design, superseded) — auto-detected data file, rendered Q5h/Q7d + burn rates + TTL + hit + PEAK/OVERAGE as a separate Line 5. Committed as e4d66bf. Refactored away after user feedback flagged the Q5h/Q7d duplication with Line 4.
14. **Unified rate-limit line (merge)** — OAuth + cache-fix data merged into Line 4. Cache-fix wins for 5h/7d (fresher), OAuth keeps sub-limits (`sonnet`/`opus`), TTL/hit/PEAK/OVERAGE folded into the same line, burn rates inline. Added `mergeRateData()` + `buildExtrasTail()` + 8-step graceful degradation in `formatRateLimitLine()`. `CONTEXTBRICKS_SHOW_CACHE_FIX=0` now means "OAuth only" instead of "hide Line 5". (v4.5.0, unpushed)

## Deferred / Open

- **npm release v4.5.0**: branch `feat/v4.5.0-quota-merge-and-ui-polish` pushed, PR #7 open. There is NO auto-publish pipeline (see npm Publishing section). Action after PR merge: tag `v4.5.0` → `gh release create` → run `npm publish` manually with owner credentials (or first land `.github/workflows/release.yml` as a separate PR).
- **Test expansion for cache-fix branches**: `contextbricks test` uses static mock OAuth data but no cache-fix mock — live testing piggy-backs on the real `~/.claude/quota-status.json`. TTL:5m red branch + idle-rebuild warning + PEAK (yellow) + OVERAGE + degradation-order under narrow widths are not covered by automated test mocks. Add an `_mock_cache_fix` field to the test fixture so `contextbricks test` can exercise every branch deterministically.
- **Line 4/5 duplication → resolved in v4.5.0**: Line 5 removed; 5h/7d now pulled from cache-fix when available, falling back to OAuth. No action needed.
- **MEMORY.md snapshot**: auto-memory at `~/.claude/projects/D--Dev-contentbricks-universal/memory/MEMORY.md` updated to v4.5.0; a 41-day-old system-reminder flagged the file as stale — future sessions should trust CONTINUITY.md over MEMORY.md for current version.
- **Pre-existing uncommitted noise** (NOT mine, left untouched): `.gitignore` adds `graphify-out/`, untracked `nul` file in repo root, untracked `.serena/` and `.agent/specs/` directories.

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
