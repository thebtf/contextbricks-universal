# ContextBricks Universal — Continuity

## Project State (2026-05-07)

**Version:** 5.0.0 — live on npm with SLSA provenance (Trusted Publisher OIDC)
**Branch:** `main` (HEAD = `8998009` — closeout commit for CR-001-initial-scope)
**Latest tag:** `v5.0.0` (https://github.com/thebtf/contextbricks-universal/releases/tag/v5.0.0)
**Prior:** v4.7.0 (published 2026-04-26)
**Local wiring:** `~/.claude/settings.json → statusLine.command` points to
`D:/Dev/contentbricks-universal/scripts/statusline.js` (live dev — not a copy).

## Done (this session, 2026-04-26)

- **TTL+hit% prefix** — moved from trailing suffix to start of Line 4. Format: `TTL:1h/99.6%`.
  Previously hit% was rounded (`Math.round`) and shown as separate segment after TTL.
  Now raw precision from cache-fix, atomic pair (both shown or both hidden).
- **Terminal width detection** — added `detectTermWidth()` opening `CONOUT$` (Windows) or
  `/dev/tty` (Unix) directly. Claude Code pipes all fds (stdin/stdout/stderr), so
  `process.stdout.columns` = 0 → false fallback to 80 columns. Root cause of premature
  graceful degradation that was hiding hit%.
- **Degradation reordered** — sonnet drops at L4 (early, per user preference), opus always
  shown when present. TTL survives until L8 (second-to-last). Order:
  L0 full → L1 short labels → L2 drop PEAK/OVERAGE → L3 drop design → L4 drop sonnet →
  L5 drop pacing → L6 drop burn → L7 drop reset → L8 drop TTL → minimum (s:X% | w:Y%).
- **hit_rate 0% fix** — truthy check replaced with `!= null` (CodeRabbit + Gemini review catch).
- **PR #15:** CodeRabbit + Gemini + Codex reviewed, 3 threads resolved, all about same issue (0% edge case).
- **v4.7.0 released:** tag + npm + SLSA provenance. CI green in 12s.

## Now

Nothing in flight. Session at natural checkpoint — **v5.0.0 shipped end-to-end**.

## Done (this session, 2026-05-07)

**F-001 / CR-001-initial-scope (topology-aware-quota) — SHIPPED.** 14 commits, tag v5.0.0, npm published, GitHub release live.

- **Architecture pivot:** statusline now sends `POST /v1/messages` через `$ANTHROPIC_BASE_URL` (whatever path Claude Code uses), parses `anthropic-ratelimit-unified-*` from response headers. Replaces hard-coded `api.anthropic.com/api/oauth/usage` call that broke under any proxy.
- **Native-first, proxy-agnostic:** zero proxy-specific code paths. Native, CPA, cache-fix-chain — all transparently supported via env-var contract.
- **9 new lib modules:** `topology, quota-source, quota-parser, creds, detect-term-width, rate-view, ansi` + `format/{rate-limit-line, ttl-prefix, extras-tail}`. Statusline.js shrunk **1142 → 362 LOC (-68%)**.
- **GATE-2 empirical resolution:** на user's `unleashed.lan:8321` default haiku chain rejected with 502; added `CONTEXTBRICKS_QUOTA_PROBE_MODEL` env override; verified `claude-opus-4-6` → 200 OK + 13 anthropic-ratelimit headers (real data: session 28%, week 7%, etc.).
- **Reset normalization:** unix-seconds `*-reset` headers normalized to ISO 8601 (Date-constructor-compatible).
- **FR-9 token confidentiality:** cache stores parsed quotas only (never raw bodies, headers, tokens); subprocess receives token via env, never argv.
- **Honest STALE UX:** `expireResetLimits()` removed; stale data renders `(stale Xh Ym)` suffix; UNAVAILABLE renders FR-8 hint enum literal instead of fake zeros.
- **82/82 tests** — 77 unit + 5 integration, full stdin-mock contract via `_mock_topology` / `_mock_probe_response` / `_mock_now_ms`.
- **Zero new npm deps.** Native Node built-ins only.

**14 commits on main:** `30df69d` T1, `5c26c73` T2, `0377605` T3, `33d8ee0` T4, `73a8b6f` T4 fix, `f3d1f52` housekeeping, `b323172` T5, `3d88154` housekeeping, `a4d22bb` T6, `d2c46f3` reset-normalize, `41150db` housekeeping, `63f9901` T8 (v5.0.0 + CHANGELOG + README), `38862fa` T7 fixtures, `8998009` closeout.

**Tag + npm:** `v5.0.0` published with SLSA provenance via OIDC Trusted Publisher, CI green in 25s.

**Pipeline artifacts (committed in `8998009`):** `.agent/specs/topology-aware-quota/{spec,plan,tasks,user_job_statement,clarification-report-2026-05-07,validation-report-2026-05-07}.md` + `checklists/requirements-quality.md` + `changes/CR-001-initial-scope/change.md` + registry `_index.json` (F-001 ACTIVE).

## Next (when resuming)

- Confirm `CONTEXTBRICKS_QUOTA_PROBE_MODEL=claude-opus-4-6` (or active proxy-recognized model) выставлен в `~/.claude/settings.json` env. Без него Line 4 показывает hint, не quotas.
- Verify live statusline Line 4 рендерит реальные ratelimit данные через CPA.
- Если cache-fix proxy локально активен — TTL/hit% prefix должен слиться в Line 4.
- Engram store F-001 decisions — background CLI запущен; check completion в `.agent/tasks/T8/engram-store-pending.md`.
- Monitor user reports на topology mismatches (новые proxy types, model dispatchers).

## Blockers

None.

## Deferred / Open (carried forward)

- **Profile endpoint `/api/oauth/profile` под proxy** — на CPA скорее всего 404. Сейчас полагается на existing 24h disk cache fallback. Если новая машина без cache + CPA → @username segment пропадёт. Documented as Out-of-Scope в spec, deferred к follow-up CR.
- **spawnSync(node, ['-e', script]) → native fetch migration** — отдельный CR, ortogonal NFR-7 концерн.
- **`TECHNICAL_DEBT.md`:** suppress `design:0%` segment когда `utilization === 0` (carry-forward from v4.7.0).
- **MAX_STALE_MS profile path** — `7d` constant остался в profile cache; стандарт NFR. Low priority.
- **Line 3 overflow protection** — нет `termWidth` check на Line 3. Low real-world frequency.
- **GitHub Actions Node.js 20 deprecation** — `actions/checkout@v4` + `actions/setup-node@v4` всё ещё на Node 20; update by June 2026.

## Resumability Test

A future agent running `/session --load` on this file should in the first 5 actions:

1. Read this CONTINUITY → see v5.0.0 shipped, no in-flight work, F-001 complete.
2. Run `npm view contextbricks-universal version` → confirm `5.0.0` (or newer).
3. Run `git log --oneline -3` → see `0a3bf4d docs(continuity): session save after v5.0.0 release` at HEAD on main.
4. Check `~/.claude/settings.json → statusLine.command` → confirm live dev-path; check `CONTEXTBRICKS_QUOTA_PROBE_MODEL` env presence (required for CPA-mode users on this box).
5. Observe statusline Line 4 → should show `session:NN%/MM% +X.Y/m ~Zd | week:...` (real ratelimit data) when env-pinned model works against the active proxy; or honest `[hint]` message when probe fails.

## What This Project Does

Cross-platform Node.js statusline for Claude Code CLI. Displays 4 lines:
1. Model + git repo:branch + dirty/ahead/behind + diff stats + @oauth_user
2. Last commit hash + message
3. Context bricks + % + free tokens + session time + cost + extra:$N/$M
4. **TTL:1h/99.6% prefix** | session/week with pacing + burn + reset | sonnet (degradable) | opus (always) | design | PEAK/OVERAGE

## Architecture

- `scripts/statusline.js` — Main statusline (~930 lines). Reads JSON from stdin, writes ANSI to stdout.
- `bin/cli.js` — CLI install/uninstall/test/help. Writes `~/.claude/statusline.js` as copy and updates settings.json command.
- `package.json` — npm package `contextbricks-universal`, bins: `contextbricks`, `contextbricks-universal`. postinstall auto-runs install.
- `.github/workflows/publish.yml` — OIDC Trusted Publisher workflow on tag push.

## Key Technical Decisions (v4.7.0 — current)

- **TTL+hit% as prefix** — leads Line 4, not trailing. Survives degradation until L8 (near-last).
  Atomic pair: both shown or both hidden. Raw precision from cache-fix (no rounding).
- **`detectTermWidth()`** — opens `CONOUT$` (Win) or `/dev/tty` (Unix) when all fds piped.
  Fallback chain: `CONTEXTBRICKS_WIDTH` → stdout.columns → stderr.columns → detectTermWidth() → `COLUMNS` → 80.
- **Sonnet-only degradation** — `includeSonnet` flag drops sonnet at L4. Opus has no dedicated
  flag — always included (rare, important when present). `includeSubLimits` removed.
- **OAuth API** remains the single authoritative source for all quota values (unchanged from v4.6.1).
- **Cache-fix extras** (TTL/hit/PEAK/OVERAGE) from `~/.claude/quota-status.json` — unchanged.
- **Degradation priority** (user-specified): TTL > session/week pacing > burn > reset > sonnet.

## npm Publishing

- OIDC Trusted Publisher via `publish.yml` on tag push (no `NPM_TOKEN`).
- Environment: `npm-publish` on GitHub.
- Node 24 required on CI (bundled npm 11.x supports OIDC).
- SLSA provenance attestation on every release.

## Upstream Issues

- **#27864** (anthropics/claude-code) — Footer layout: notification bar squeezes statusline. OPEN.

## Lessons Learned (cumulative)

- `anthropic-beta: oauth-2025-04-20` is required for OAuth usage API (undocumented).
- `spawnSync` with OAuth 429 returns exit 0 + empty stdout (not an exception).
- Node 22's bundled npm 10.x silently falls back to token auth under Trusted Publisher config.
- On Windows `npm install -g <path>` makes a **copy**, not a symlink. Use direct path in settings.json.
- `process.stdout.columns` = 0 when stdout is piped. `process.stderr.columns` also 0 when Claude Code pipes stderr. Must use `CONOUT$`/`/dev/tty` to get real terminal width.
- `extras.hit` truthy check hides valid `0` — use `!= null` for nullable values from cache-fix.
- Graceful degradation order is a UX decision, not a technical one — user preference drives priority.

## Engram Keys

- **id 69644** — v4.6.1 OAuth-authoritative decision.
- **v4.7.0 session** — TTL prefix, detectTermWidth, sonnet-only degradation decisions.
