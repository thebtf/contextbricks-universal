# Changelog

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
