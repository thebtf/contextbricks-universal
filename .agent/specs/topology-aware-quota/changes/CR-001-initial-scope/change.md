# Design — Quota from Response Headers (Walk Where Claude Walks)

**Feature slug:** `topology-aware-quota`
**Status:** DRAFT v3 (auth-files hijack rejected — header-based source is the right answer)
**Authored:** 2026-05-07
**Brainstorm trigger:** v4.7.0 statusline goes thin under CPA-mode. v3 settles on the correct architecture: statusline sends one minimal Messages API request through whatever path Claude Code already uses, then reads `anthropic-ratelimit-unified-*` from the response headers. CPA passes those headers through (verified in source: `header_filter.go` blocklist does NOT include them). No OAuth hijack, no auth-files, no extra config.

---

## Purpose

Statusline must walk the same path Claude Code walks — same `ANTHROPIC_BASE_URL`, same `ANTHROPIC_AUTH_TOKEN`. Quota truth lives in Anthropic response headers, which CPA forwards verbatim. Statusline emits a tiny Messages API request, reads headers, renders. Files become a fallback for offline display, not the contract.

**Verification anchor:**
- `router-for-me/CLIProxyAPI/sdk/api/handlers/header_filter.go` — `FilterUpstreamHeaders` strips only hop-by-hop + AI-gateway-prefix headers (`x-litellm-`, `helicone-`, `x-portkey-`, `cf-aig-`, `x-kong-`, `x-bt-`). `anthropic-ratelimit-*` not in blocklist → forwarded.
- `~/.claude/quota-status.json` on the diagnostic machine contains `all_headers` array with full `anthropic-ratelimit-unified-*` set → empirically captured through CPA chain (cache-fix saw them in response from CPA).

Removes 7 of the 8 v4.7.0 architectural smells:

| # | Smell | Resolved |
|---|-------|----------|
| 1 | Hard-coded `api.anthropic.com` | Use `ANTHROPIC_BASE_URL` — CPA, native, anything transparent |
| 2 | No OAuth refresh on 401 | Not needed — Bearer token is whatever Claude Code already uses |
| 3 | `MAX_STALE_MS = 5h` mixes window with fallback TTL | Cache TTL 60–180s; stale-fallback up to 24h, clearly labeled |
| 4 | Dual source of truth (OAuth + cache-fix) | Single source — response headers |
| 5 | `expireResetLimits()` fakes 0% | Removed — every render gets live data |
| 6 | No stale-indicator | Renderer reads cached `freshness`, marks suffix |
| 8 | Token discovery only from `.credentials.json` | Token lookup mirrors Claude Code: ENV first, creds second |

(#7 — spawnSync overhead — orthogonal, separate CR.)

---

## User Profile

**Primary user:** Power user on multi-machine fleet. Claude Code configured for whatever topology fits (CPA on `unleashed.lan:8321`, native OAuth on dev box, occasionally cache-fix in chain). Wants statusline to "just work" with zero per-machine config. Pays Claude Max + maintains CPA.

**Pain today (verified, 2026-05-07):**
- 4-day-old OAuth in `.credentials.json`, never refreshed (CPA-mode skips OAuth flow)
- `usage-cache.json` 4 days old, dropped because MAX_STALE_MS=5h
- Cache-fix not running on this box → no `quota-status/` directory
- Line 4 collapses to fake `s:0% | w:0%` zeros

**What "fixed" looks like:**
- Statusline sends 1 minimal `/v1/messages` request through `ANTHROPIC_BASE_URL` (whatever it points to)
- Response headers carry the full ratelimit truth → render that
- Zero new env vars to set
- Network/upstream failure → graceful stale-suffix from disk cache, then null-source hint

---

## Approach (one, recommended)

**APPROACH F — Response-header source (RECOMMENDED, CONFIDENCE: HIGH)**

Single `HeaderProbeQuotaSource`:
1. `POST $ANTHROPIC_BASE_URL/v1/messages` (or `api.anthropic.com` if `ANTHROPIC_BASE_URL` unset)
   - `Authorization: Bearer $ANTHROPIC_AUTH_TOKEN` (env first), or Bearer from `.credentials.json.claudeAiOauth.accessToken` (fallback)
   - `anthropic-version: 2023-06-01`
   - Body: `{"model": "<cheapest-available>", "max_tokens": 1, "messages": [{"role":"user","content":"."}]}`
2. Read response headers, parse all `anthropic-ratelimit-unified-*-utilization` / `*-reset` pairs
3. Map to existing quota shape (five_hour, seven_day, seven_day_sonnet, seven_day_opus, seven_day_omelette, overage)
4. Cache on disk 60–180s; stale-fallback up to 24h with clear label

**Why this is the answer (and the prior auth-files hijack was wrong):**
- Walks the path Claude Code uses, by definition — same env, same auth, same proxy
- Token freshness is the proxy's problem, not statusline's
- No OAuth flow knowledge in statusline
- One source = no priority chain to debug
- CPA proven transparent for these headers (source-verified + empirical)

### Rejected (kept for record)

| Rejected | Why rejected |
|----------|--------------|
| Direct `api.anthropic.com/api/oauth/usage` (v4.7.0 status quo) | Hardcodes endpoint, requires fresh OAuth refresh, breaks under proxy |
| CPA `/v0/management/auth-files` hijack (v2 of this design) | Steals tokens from CPA's storage — security & coupling violation |
| Forking cache-fix to add `/quota` | Owner of upstream fork, drift inevitable |
| Sidecar process | Solves a problem we don't have |
| File-only sources | Cache-fix optional in user's setup; can't be required |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│  statusline.js                                          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ HeaderProbeQuotaSource.fetch(nowMs)              │  │
│  │                                                   │  │
│  │   1. resolve target = ANTHROPIC_BASE_URL ??       │  │
│  │      'https://api.anthropic.com'                  │  │
│  │   2. resolve auth = ANTHROPIC_AUTH_TOKEN ??       │  │
│  │      .credentials.json.accessToken                │  │
│  │   3. hit on-disk cache; if age < TTL → return    │  │
│  │   4. else POST $target/v1/messages (max_tokens=1) │  │
│  │   5. parse anthropic-ratelimit-unified-* headers │  │
│  │   6. write cache; return {data, freshness:FRESH} │  │
│  │                                                   │  │
│  │   on network error / non-2xx:                     │  │
│  │     stale fallback (age < 24h) → STALE            │  │
│  │     else → null                                   │  │
│  └─────────────────────────────────────────────────┘  │
│                       ↓                                 │
│  ┌────────────────────────────────────────────────┐   │
│  │ NullSource (terminator)                          │   │
│  │   {data:null, freshness:UNAVAILABLE,             │   │
│  │    hint: 'no auth token; configure                │   │
│  │    ANTHROPIC_AUTH_TOKEN or run claude'}           │   │
│  └────────────────────────────────────────────────┘   │
│                       ↓                                 │
│  buildRateView(result) → formatRateLimitLine            │
└────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### `HeaderProbeQuotaSource` (`scripts/lib/quota-source.js`)

**Inputs:** `nowMs`, env vars
**Outputs:** `{data, freshness, age_ms, source_id} | null`

**Endpoint resolution:**
- target = `process.env.ANTHROPIC_BASE_URL` || `'https://api.anthropic.com'`
- normalize: strip trailing slash, ensure protocol prefix

**Auth resolution (mirrors Claude Code):**
- token = `process.env.ANTHROPIC_AUTH_TOKEN` || `process.env.ANTHROPIC_API_KEY` || `readFromCredsJson()`
- If none → return null with hint via NullSource

**Cache (`~/.claude/.contextbricks-quota-cache.json`):**
- Fresh: age < 60s → return cached, freshness=FRESH
- Stale: age 60s–180s → return cached, freshness=FRESH (still in primary TTL window)
- Refresh: age > 180s → trigger probe; on success, refresh cache

**Probe request:**
- `POST $target/v1/messages`
- Headers: `Authorization: Bearer $token`, `anthropic-version: 2023-06-01`, `content-type: application/json`, `anthropic-beta: oauth-2025-04-20` (kept — works for both OAuth-tokens and CPA api-keys per empirical evidence)
- Body: `{"model": "<minimal>", "max_tokens": 1, "messages": [{"role":"user","content":"."}]}`
- Model selection: hardcoded list of cheapest-available probed in order: `claude-haiku-4-5`, `claude-haiku-3-5`, `claude-3-5-haiku-20241022`. First non-404 wins, model name persisted to cache.
- Timeout: 4000ms (matches existing `fetchUsageData`)

**Header parsing:**
- For each header matching `^anthropic-ratelimit-unified-(.+)-utilization$`:
  - extract bucket name (`5h`, `7d`, `7d_sonnet`, `7d_opus`, `overage`, `7d_omelette`, etc.)
  - look up matching `-reset` and `-status` headers
  - emit `{utilization: parseFloat(val), resets_at: <ISO>, status}`
- Map to existing OAuth-usage shape:
  - `5h` → `five_hour`
  - `7d` → `seven_day`
  - `7d_sonnet` → `seven_day_sonnet`
  - `7d_opus` → `seven_day_opus`
  - `7d_omelette` → `seven_day_omelette`
  - `overage` → `extra_usage`-shaped object (utilization-only)

**Stale-fallback:**
- On any non-2xx or network failure with age 180s–24h:
  - return `{data: cached, freshness: STALE, age_ms}` so renderer marks staleness
- On age > 24h or no cache:
  - return null → NullSource takes over

### `NullSource`
- Always-available terminator
- Returns `{data: null, freshness: UNAVAILABLE, hint_message}`
- Hints:
  - No auth token in env or creds → `[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]`
  - Probe consistently 401 → `[auth token rejected — refresh credentials]`
  - Probe consistently 5xx → `[API unreachable — service degraded]`

### `buildRateView(result)` (refactored)
- Same outputs as today (session/week/sonnet/opus/design)
- Pass through `freshness`, `source_id`
- `expireResetLimits()` REMOVED

### `formatRateLimitLine(merged, termWidth)` (refactored)
- Add suffix `(stale Xh, hdr-probe)` when `freshness === STALE`, dim color
- When `freshness === UNAVAILABLE`, replace quota segments with single-line hint, dim
- Existing 9-step degradation chain preserved; freshness/source-id badge participates at L8

### Profile fetching (Line 1 @username) — also benefits

Currently `fetchUserProfile()` directly calls `api.anthropic.com/api/oauth/profile`. That breaks under CPA-mode for the same reason quotas did. Same fix: probe `$ANTHROPIC_BASE_URL/api/oauth/profile`. CPA may not implement that endpoint (404 likely → fallback to file `~/.claude/.profile-cache.json` — already implemented). 24h cache continues to be sufficient.

Optional, deferred: derive @username from CPA management `/auth-files/download` if user opts in. Out of scope for v5.0 — current 24h cache covers the case where user has logged in even once.

---

## Configuration

**Zero new env vars required for happy path.** Existing reads:
- `ANTHROPIC_BASE_URL` — already set when using CPA
- `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`) — already set when using CPA
- Falls back to `.credentials.json` for native OAuth (current v4.7.0 behavior)

**Optional (debug):**

| Var | Purpose | Default |
|-----|---------|---------|
| `CONTEXTBRICKS_QUOTA_PROBE_MODEL` | Override probe model (debugging) | auto-pick from haiku list |
| `CONTEXTBRICKS_QUOTA_CACHE_TTL_S` | Override cache TTL | 180 |
| `CONTEXTBRICKS_QUOTA_DISABLE` | Skip quota probe entirely | unset |

---

## Data Flow

```
1. statusline boot (per render)
2. Read env (sync, < 1ms)
3. HeaderProbeQuotaSource.fetch(nowMs):
   a. cache hit & age < TTL → return cached
   b. else POST /v1/messages, parse headers, write cache, return
   c. on failure with stale data → return STALE
   d. on no data → return null
4. If null → NullSource → hint message
5. buildRateView → pass through freshness
6. formatRateLimitLine → render with stale-suffix or hint
7. Write 4 lines
```

---

## Interfaces

**Module structure:**
```
scripts/
  statusline.js          ← orchestrator only, ~400 LOC
  lib/
    quota-source.js      ← HeaderProbeQuotaSource + NullSource
    quota-parser.js      ← header → quota-shape mapping
    rate-view.js         ← buildRateView
    format/
      rate-limit-line.js ← formatRateLimitLine
      ttl-prefix.js      ← buildTTLPrefix (existing, untouched)
      extras-tail.js     ← buildExtrasTail (existing, untouched)
    detect-term-width.js ← (existing, untouched)
    creds.js             ← readOAuthToken + readCredentialsExpiresAt
```

**Wire types:**
```typescript
interface QuotaResult {
  data: {
    five_hour?: { utilization: number; resets_at: string; status?: string };
    seven_day?: { utilization: number; resets_at: string; status?: string };
    seven_day_sonnet?: { utilization: number; resets_at: string; status?: string };
    seven_day_opus?: { utilization: number; resets_at: string; status?: string };
    seven_day_omelette?: { utilization: number; resets_at: string; status?: string };
    extra_usage?: { utilization: number; resets_at: string };
  } | null;
  freshness: 'FRESH' | 'STALE' | 'UNAVAILABLE';
  age_ms: number;
  source_id: 'hdr-probe' | 'cache-stale' | 'null';
  hint_message?: string;
}
```

---

## Error Handling Strategy

- All errors caught locally, never throw to caller
- 4xx (auth) → null + hint
- 5xx / network → if cache age < 24h → STALE; else null
- JSON-parse error on cache → null
- Headers missing → null with `[probe returned no ratelimit headers]` hint
- Goal: statusline never crashes; output always exists; degradation honest

---

## Testing Approach

**Unit (Node test runner):**
- `quota-parser.test.js` — header → shape mapping; missing fields; malformed values
- `quota-source.test.js`:
  - cache hit FRESH → no probe
  - cache stale + probe ok → FRESH refresh
  - cache stale + probe 5xx + age < 24h → STALE
  - cache stale + probe 5xx + age > 24h → null
  - no cache + probe 401 → null with hint
  - probe model fallback chain (haiku-4-5 → 3-5 → ...)
- `null-source.test.js` — hint per failure mode
- `format/rate-limit-line.test.js` — STALE suffix, UNAVAILABLE single-line render

**Integration:**
- 5 fixtures: native fresh / native expired / CPA happy / CPA 502 / no-config
- Mock filesystem + HTTP per fixture
- Snapshot Line 4

**Manual validation on diagnostic box (CPA-mode, 4-day-stale):**
- Run statusline → expect probe → expect `anthropic-ratelimit-unified-*` headers → expect Line 4 fully populated
- Disable network → re-render after 4 min → expect `(stale 4m)` suffix
- Wipe cache, drop auth → expect `[no API auth]` hint

---

## Open Questions

1. **CPA returning 502 on synthetic probe.** During design verification, `POST $ANTHROPIC_BASE_URL/v1/messages` from PowerShell returned 502. Claude Code probes the same endpoint successfully. Two possibilities: (a) CPA dispatches by model availability — `claude-haiku-4-5` may not be wired in this CPA; (b) specific header set required. Mitigation: implementation iterates through model fallback list until non-error, persists the working model name. If all 502 → NullSource with `[CPA upstream unhealthy]` hint. Not a design blocker.
2. **Cost.** ≈5 input + 1 output tokens per probe. At 180s TTL → 20 probes/hour, 480/day, ≈$0.0001/day on Haiku. Effectively free. But: subscription "session" quota (5h window) counts every request — including ours. We'll use ≈0.1% of typical session quota. Acceptable. Document in CHANGELOG.
3. **Model name pinning.** Once probe finds working model, persist in cache. Re-discover only on probe failure with current model.
4. **Profile endpoint under CPA.** `api/oauth/profile` likely 404 through CPA. File cache (24h) sufficient. Empty cache + CPA → no @username, drop the segment.

---

## Not Doing (explicit scope exclusions)

- **NOT calling `/api/oauth/usage` directly** — that's the path that broke
- **NOT reading CPA `auth-files`** — security/coupling violation, prior bad design
- **NOT forking CPA or cache-fix**
- **NOT performing OAuth token refresh from statusline**
- **NOT migrating from `spawnSync(node, ['-e'])` to native fetch** — separate CR
- **NOT adding a CPA-side `/quota` endpoint** — out of repo scope
- **NOT requiring cache-fix install** — orthogonal
- **NOT changing Line 1/2/3 layout** — only Line 4 logic + the @username fallback
- **NOT supporting "no auth at all" mode** — statusline already needs git, requiring Claude Code env is consistent

---

## Self-Review Checklist (Step 7)

- [x] No TBD/TODO placeholders
- [x] Approach has concrete tradeoffs documented
- [x] Architecture matches description
- [x] Naming consistent (`HeaderProbeQuotaSource`)
- [x] ≈300 LOC change estimate, single feature
- [x] Two engineers building from this would land same module structure
- [x] Not-Doing list explicit
- [x] Open Questions named, none block design approval

---

## Handoff to /nvmd-specify

Becomes input for FR/NFR/User-Stories/Edge-Cases. Expected:
- FR-1..FR-N: probe contract, header parsing, cache behaviour
- NFR-1..NFR-M: probe TTL ≤180s, stale fallback ≤24h, no crash on any input
- US: native fresh / native expired / CPA happy / CPA upstream-broken / no-auth
- Edge cases: model fallback chain exhaustion, headers partially missing, 429/5xx series
