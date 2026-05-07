# Changelog

## [5.0.0] — 2026-05-07

### Changed (BREAKING for nobody — proxy-mode users gain quota visibility, native users see no diff)
- **Quota source replaced: response headers, not OAuth API.** Statusline now sends a single minimal `POST /v1/messages` (max_tokens: 1, "." prompt) through `$ANTHROPIC_BASE_URL` and parses `anthropic-ratelimit-unified-*` from the response. Previously called `/api/oauth/usage` directly with a hard-coded `api.anthropic.com` host, which silently broke under any proxy.
- **Native-first, proxy-agnostic.** No proxy-specific code paths. ENV-vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`) drive runtime resolution; statusline mirrors Claude Code's own resolution order. CLIProxyAPI / claude-code-cache-fix / native OAuth — all transparently supported.
- **Pass-through-unknown bucket parser.** New `anthropic-ratelimit-unified-*` buckets (e.g., future `7d_haiku`) preserved verbatim under `quotas[<name>]` instead of silently dropped. Forward-compatible without code change.
- **Honest staleness rendering.** `expireResetLimits()` removed — no more fake `0%` quota when a window resets but probe fails. Stale data renders with a dim `(stale Xh Ym)` suffix; total upstream failure renders a single dim hint message instead of zero-filled segments.
- **Module split.** `scripts/statusline.js` shrunk from ~1140 LOC to ~400 LOC. Logic lives in `scripts/lib/{topology,quota-source,quota-parser,creds,detect-term-width,rate-view,ansi}.js` + `scripts/lib/format/{rate-limit-line,ttl-prefix,extras-tail}.js`.

### Added
- **`CONTEXTBRICKS_QUOTA_PROBE_MODEL` env var.** Pin a model for the quota probe — required for proxies whose dispatcher rejects the default Haiku-tier names (e.g., CLIProxyAPI configured for OpenRouter-style provider mapping). Example: `CONTEXTBRICKS_QUOTA_PROBE_MODEL=claude-opus-4-6`. When the default chain works (native Anthropic), no env var needed.
- **FR-9 token confidentiality contract.** Bearer tokens never written to cache, hint messages, or stderr. Subprocess receives token via `env`, never argv.
- **Cache freshness state machine.** `~/.claude/.contextbricks-quota-cache.json` stores parsed quotas + meta only. FRESH < 180 s, STALE < 24 h, UNAVAILABLE >= 24 h. Atomic write via tmp+rename (POSIX) with Windows EBUSY retry-once + direct-write fallback.
- **Probe model fallback chain.** When env override absent: `claude-haiku-4-5 -> claude-haiku-3-5 -> claude-3-5-haiku-20241022`. First non-error model persisted to cache.
- **Anthropic-beta header chooser.** Tries `claude-code-20250219` first, falls back to no-beta on 4xx (non-model-not-found), persists working set.
- **Failure-mode taxonomy.** Five hint-kind enum values render as distinct Line 4 messages: `[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]`, `[auth token rejected — refresh credentials]`, `[API unreachable — service degraded]`, `[probe returned no ratelimit headers]`, `[no compatible probe model in upstream — set CONTEXTBRICKS_QUOTA_PROBE_MODEL]`.

### Removed
- **`expireResetLimits()`** — replaced by honest STALE freshness flag (FR-6).
- **Hard-coded `api.anthropic.com` host** in `https.request`. Now resolves via `$ANTHROPIC_BASE_URL` like Claude Code does.

### Migration
- v4.7.0 cache files (`~/.claude/.usage-cache.json`, `~/.claude/.profile-cache.json`) are left untouched. v5.0 writes its own `~/.claude/.contextbricks-quota-cache.json`. No postinstall delete; old files become orphans (<= 2 KB each).
- ENV vars (`CONTEXTBRICKS_*`) and Claude Code env vars (`ANTHROPIC_BASE_URL`, etc.) all preserve v4.7.0 semantics. No breaking changes for native-OAuth users.
- **CPA / cache-fix / proxy-chain users:** if your statusline shows `[no compatible probe model in upstream]`, set `CONTEXTBRICKS_QUOTA_PROBE_MODEL=<model-name-your-proxy-recognizes>` (e.g., `claude-opus-4-6` if your CPA dispatcher maps Opus).

### Architecture references
- Spec, plan, tasks, validation report: `.agent/specs/topology-aware-quota/`
- Architectural rationale: `.agent/specs/topology-aware-quota/changes/CR-001-initial-scope/change.md`
- GATE-2 live-CPA evidence: `.agent/specs/topology-aware-quota/evidence/gate-2-probe-result.txt`

## [4.7.0] — 2026-04-26

### Changed
- **TTL+hit% moved to start of Line 4** — `TTL:1h/99.6%` prefix leads the line (was trailing suffix). TTL and hit% are an atomic pair: both shown or both hidden.
- **Raw hit% precision** — displays value from cache-fix as-is (e.g., `99.6%`). Previously `Math.round()` turned 99.6 → 100%.
- **Degradation reordered** — sonnet drops at L4 (early), opus always shown when present. TTL survives until L8 (second-to-last). New order: PEAK → design → sonnet → pacing → burn → reset → TTL → minimum.

### Fixed
- **Terminal width detection** — added `detectTermWidth()` that opens `CONOUT$` (Windows) or `/dev/tty` (Unix) directly. Claude Code pipes all fds, causing `process.stdout.columns` to be 0 and false fallback to 80 columns. Line 4 was degrading prematurely on wide terminals.
- **hit_rate 0% no longer hidden** — `extras.hit` truthy check replaced with null check. A valid 0% hit rate is now displayed correctly.

### No breaking changes
All existing environment variables continue to work.

## [4.6.1] — 2026-04-20

### Fixed
- **Stale cache-fix no longer overrides OAuth weekly limit** — quota-status.json frozen 39h was causing statusline to show `w:13%` while OAuth reported `45%`. OAuth is now the single authoritative source for all quota values (session/week/sonnet/opus/design).

### Refactored
- **OAuth-authoritative data model** (ADR-001): 5h/7d/sonnet/opus/design always from OAuth `/api/oauth/usage`. Cache-fix cannot influence quota percentages.
- **Removed dead idle-rebuild warning** (`⚠ idle >5m = NK rebuild`): was unreachable after v4.6.0 return-shape change zeroed the `cacheCreation`/`cacheRead` fields. Dead code cleaned up.
- **Cache-fix extras only** (ADR-002): `readCacheFixExtras` (renamed from `readCacheFixQuota`) returns only TTL tier, cache hit rate, PEAK, OVERAGE — no quota fields.
- **30-minute staleness gate** (ADR-003): `readCacheFixExtras` returns null when `ts` is older than 30 minutes. Future timestamps (clock skew) treated as fresh.
- **Removed org-id gate** (ADR-004): `expectedOrgId`, `cfRejected`, `cannotVerify`/`orgMismatch` logic deleted. No longer needed since cache-fix cannot influence quota values.
- **Pure functions take `nowMs`** (ADR-005): `buildRateView`, `computePacing`, new `computeBurn` all take `nowMs` as a required parameter. No hidden `Date.now()` calls inside pure functions.
- **Extracted `computeBurn`** pure utility function (previously inlined twice for 5h and 7d windows).
- Net negative LOC delta in `scripts/statusline.js` (target: >= 40 lines removed).

### Changed
- `CONTEXTBRICKS_SHOW_CACHE_FIX=0` semantics updated: now means "disable extras" (was "OAuth-only mode"). Core quota values are always from OAuth regardless of this setting.
- Burn rates (`+0.4/m`, `+1.3/hr`) now computed from OAuth data (were from cache-fix only in v4.6.0).

### No breaking changes
All existing environment variables continue to work. Line 4 layout is visually identical for a healthy cache-fix.
