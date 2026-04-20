# ContextBricks Universal — Continuity

## Project State (2026-04-20)

**Version:** 4.6.1 — live on npm with SLSA provenance (Trusted Publisher OIDC)
**Branch:** `main` (HEAD = `c5e1ccf` — squash merge of PR #14)
**Latest tag:** `v4.6.1` (https://github.com/thebtf/contextbricks-universal/releases/tag/v4.6.1)
**Prior:** v4.6.0 (published 2026-04-19)
**Local wiring:** `~/.claude/settings.json → statusLine.command` points to
`D:/Dev/contentbricks-universal/scripts/statusline.js` (live dev — not a copy).
Any edit to main repo → active on next statusline render.

## Done (this session, 2026-04-20)

- **Bug fix shipped:** stale `~/.claude/quota-status.json` (39 h) no longer overrides fresh OAuth data.
  User-visible symptom before: `w:13%`; after: `w:45%` matching Anthropic dashboard.
- **OAuth-authoritative data model** — 5 ADRs in `.agent/specs/rate-limit-refactor-v4.6.1/architecture.md`:
  ADR-001 OAuth sole source for session/week/sonnet/opus/design;
  ADR-002 cache-fix extras-only (TTL/hit/PEAK/OVERAGE);
  ADR-003 30-min staleness gate;
  ADR-004 remove org-id cross-account gate;
  ADR-005 pure functions take `nowMs` parameter.
- **SpecKit artifacts:** `spec.md`, `plan.md`, `tasks.md`, `architecture.md` in spec folder.
- **10 commits → squash-merged → v4.6.1:** T1-T6 initial + 3 code-review fix commits + 1 PR-review fix commit.
  Net -43 LOC in `scripts/statusline.js`.
- **PR #14:** coderabbit + gemini + greptile reviewed; 7 threads resolved (2 MAJOR fixes applied, 5 pre-addressed by same commit).
- **Engram memory stored:** id 69644 — replaces v4.6.0 "cache-fix takes priority" with new OAuth-authoritative decision.
- **Local wiring switched to dev-path** in `~/.claude/settings.json`.

## Now

Nothing in flight. Session at natural checkpoint — v4.6.1 shipped end-to-end (tag + release + npm + SLSA).

## Next (when resuming)

- On next statusline render: verify `w:45%` (or current real value) displayed, confirming dev-path wiring is live.
- Monitor first `claude-code-cache-fix` writes — if extras render TTL/hit again, the full fix is validated in the wild.
- Pick up from `inbox` if new user reports arrive (statusline bugs, additional refactor candidates).

## Blockers

None.

## Deferred / Open (carried forward)

- **`TECHNICAL_DEBT.md`:** suppress `design:0%` segment when `utilization === 0` (carry-forward, not a regression; pre-existed in v4.5.0).
- **Worktree `D:/Dev/contentbricks-wt/v4.6.1-oauth-authoritative`** — removal failed (file lock). Clean via `git worktree prune` after the locking process closes.
- **Test fixture for real-world staleWhileError scenario** — current `staleWhileError` variant is deterministic-equal to `oauthOnly` in test env (documented honestly in label). Real 429 path requires live-API harness not currently available.
- **MAX_STALE_MS constants (OAuth path)** — distinct from `CACHE_FIX_MAX_AGE_MS` (extracted this release). Two OAuth constants (`7d` profile cache, `5h` stale-while-error usage cache) remain inline; low priority.

## Resumability Test

A future agent running `/nvmd-platform:session --load` on this file should in the first 5 actions:

1. Read this CONTINUITY → see v4.6.1 shipped, no in-flight work.
2. Run `npm view contextbricks-universal version` → confirm `4.6.1` (or newer).
3. Run `git -C "D:/Dev/contentbricks-universal" log --oneline -3` → see `c5e1ccf v4.6.1 — Rate-Limit Refactor (OAuth-authoritative) (#14)` at HEAD.
4. Check `~/.claude/settings.json → statusLine.command` → confirm it points to `D:/Dev/contentbricks-universal/scripts/statusline.js` (live dev-path, not `~/.claude/statusline.js`).
5. Read `.agent/specs/rate-limit-refactor-v4.6.1/architecture.md` ADR section → understand the new OAuth-authoritative data model before any further edits to the rate-limit subsystem.

All context needed to resume is encoded in this file + git + GitHub + npm + engram (id 69644). No tribal knowledge required.

## What This Project Does

Cross-platform Node.js statusline for Claude Code CLI. Displays 4 lines:
1. Model + git repo:branch + dirty/ahead/behind + diff stats + @oauth_user
2. Last commit hash + message
3. Context bricks + % + free tokens + session time + cost + extra:$N/$M
4. **Unified rate-limit line** (as of v4.6.1): OAuth authoritative for session/week/sonnet/opus/design + optional extras (TTL/hit/PEAK/OVERAGE) from cache-fix when fresh (<30 min)

## Architecture

- `scripts/statusline.js` — Main statusline (~900 lines post-refactor). Reads JSON from stdin, writes ANSI to stdout.
- `bin/cli.js` — CLI install/uninstall/test/help. Writes `~/.claude/statusline.js` as copy and updates settings.json command.
- `package.json` — npm package `contextbricks-universal`, bins: `contextbricks`, `contextbricks-universal`. postinstall auto-runs install.
- `.github/workflows/publish.yml` — OIDC Trusted Publisher workflow on tag push.

## Key Technical Decisions (v4.6.1 — current)

See `.agent/specs/rate-limit-refactor-v4.6.1/architecture.md` for the full ADR list + mermaid diagram. Summary:

- **OAuth API** (`/api/oauth/usage` + `/api/oauth/profile`) is the single authoritative source for all quota values.
  Required header: `anthropic-beta: oauth-2025-04-20`. Cache TTL 180 s + stale-while-error up to 5 h.
- **`claude-code-cache-fix` files** (`~/.claude/quota-status.json`, `claude-meter.jsonl`) — read only for extras
  (TTL tier, cache hit rate, PEAK, OVERAGE). Rejected if `ts` older than 30 min or malformed.
- **Pure functions take `nowMs`** — `buildRateView`, `computePacing`, `computeBurn`, `gateAndNormalize`.
  `main()` captures `Date.now()` once and threads it through.
- **Burn rates** computed from OAuth data: `+0.X/m` for 5h, `+0.X/hr` for 7d. Suppressed when `pct ≤ 0` or `elapsedMin ≤ 1`.
- **10-step graceful degradation** preserved from v4.5.0 — short labels → drop markers → drop TTL → drop design → drop pacing → drop burn → drop reset → drop sub-limits. Minimum: `s:X% | w:Y%`.
- **Env toggles:** `CONTEXTBRICKS_SHOW_LIMITS=0` hides Line 4; `CONTEXTBRICKS_SHOW_CACHE_FIX=0` disables extras
  (semantics: NOT "OAuth-only" — quotas always from OAuth; this only gates TTL/hit/PEAK/OVERAGE).

## npm Publishing

- OIDC Trusted Publisher via `publish.yml` on tag push (no `NPM_TOKEN`).
- Environment: `npm-publish` on GitHub.
- Node 24 required on CI (bundled npm 11.x supports OIDC; Node 22's npm 10.x does not).
- Every release: `npm publish --access public` with SLSA provenance attestation (`https://slsa.dev/provenance/v1`).

## Upstream Issues

- **#27864** (anthropics/claude-code) — Footer layout: notification bar squeezes statusline. OPEN.

## Lessons Learned (cumulative)

- `anthropic-beta: oauth-2025-04-20` is required for OAuth usage API (undocumented).
- `spawnSync` with OAuth 429 returns exit 0 + empty stdout (not an exception) — stale-fallback must live outside catch.
- Node 22's bundled npm 10.x silently falls back to token auth under Trusted Publisher config — always pin Node 24 for OIDC.
- On Windows `npm install -g <path>` makes a **copy**, not a symlink. Use a direct path in `settings.json` for live dev.
- `includeIdleWarning` branch in `buildExtrasTail` became unreachable in v4.6.0 when `readCacheFixQuota` return-shape dropped `cache_creation`/`cache_read` — silent dead code surfaced by next-round code review.
- `_mock_cache_fix: null` causes `readCacheFixExtras` to fall through to real filesystem → non-deterministic tests. Use `{ ts: staleTs }` sentinel instead.

## Engram Keys (this release)

- **id 69644** — v4.6.1 OAuth-authoritative decision (replaces prior v4.6.0 "cache-fix priority" stance).
- Earlier global memories (v4.6.0 cycle) remain — now historical context, NOT active guidance for this project.
