# Technical Debt

## Deferred changes (not blockers)

### 2026-04-20: Suppress `design:0%` segment when utilization is 0

**What:** When `oauthData.seven_day_omelette.utilization === 0` and `resets_at` is
present, Line 4 still renders `design:0% ~NNd`. For users who have the omelette
feature flag enabled but never used Claude Design, this adds visual noise.

**Why deferred:** Not a regression introduced by v4.6.1 — carried forward from v4.5.0
behavior. Fix requires a policy decision (suppress entirely, or threshold-based, or
keep as engagement signal).

**Impact:** Cosmetic. Users with `design:0%` present see an always-zero indicator.

**Context:** `scripts/statusline.js` `buildRateView` around line 578 guards on
`seven_day_omelette.resets_at`. Add a second guard on `utilization > 0` for the
behavior change.
