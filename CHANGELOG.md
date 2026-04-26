# Changelog

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
