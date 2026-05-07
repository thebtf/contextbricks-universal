---
feature_id: F-001
slug: topology-aware-quota
title: Topology-Aware Quota Source — Statusline Walks Where Claude Walks
state: ACTIVE
created: 2026-05-07
last_modified: 2026-05-07
author: AI Agent (Claude Opus 4.7) — reviewed by user
provenance:
  specified_by: claude-opus-4-7
  date: 2026-05-07
  evidence_sources:
    - conversation transcript 2026-05-07 (8 verbatim user quotes Q-1..Q-8)
    - .agent/specs/topology-aware-quota/user_job_statement.md
    - scripts/statusline.js v4.7.0 (read-only inspection)
    - router-for-me/CLIProxyAPI/sdk/api/handlers/header_filter.go (verified via Nia)
    - ~/.claude/quota-status.json (empirical anthropic-ratelimit headers snapshot)
    - cnighswonger/claude-code-cache-fix README (proxy contract)
  confidence: VERIFIED (header forwarding behaviour) + INFERRED (CPA 502 root cause)
active_change_request: CR-001-initial-scope
change_history:
  - id: CR-001-initial-scope
    title: Initial scope — replace direct OAuth-API call with response-header probe via $ANTHROPIC_BASE_URL
    state: open
    created: 2026-05-07
---

# Feature: Topology-Aware Quota Source — Statusline Walks Where Claude Walks

## Clarifications

### Session 2026-05-07

| # | Category | Question | Resolution | Date |
|---|----------|----------|------------|------|
| C1 | Data Lifecycle | What to do with v4.7.0 cache files (`.usage-cache.json`, `.profile-cache.json`) on upgrade? | **Ignore-and-leave.** v4.7.0 cache files stay on disk untouched. v5.0 writes to its own paths. No migration logic, no postinstall delete. Documented as explicit Out-of-Scope. | 2026-05-07 |
| C2 | Security | What is allowed to appear in cache content / hint messages / process stderr? | **FR-9 Token Confidentiality** — cache stores only parsed quota values + freshness + age + source_id + hint_kind enum (no raw bodies, no headers beyond parsed `unified-*`, no env-var dumps). Hint messages are enum literals without token interpolation. Stderr is silent on probe failure. Subprocess receives token via env, never argv. Debug-mode override rejected — security risk > debugging value for a per-render statusline. | 2026-05-07 |
| C3 | Domain/Data Model | How does the parser handle Anthropic adding new bucket names (e.g., `7d_haiku`, `1d`, `monthly`) to the `anthropic-ratelimit-unified-*` header family? | **Pass-through-unknown.** Parser captures any `^anthropic-ratelimit-unified-(.+)-utilization$` via regex. Known buckets map to canonical names (`5h → five_hour`, `7d → seven_day`, `7d_sonnet → seven_day_sonnet`, `7d_opus → seven_day_opus`, `7d_omelette → seven_day_omelette`, `overage → extra_usage`). Unknown buckets are stored under the original bucket name in a `quotas[bucket_name]` map but NOT rendered by default (no rendering label assigned). Forward-compatible: new Anthropic bucket appears in cache without code change. Strict whitelist rejected — would replicate v4.7.0 silent-drop bug visible in the user's `quota-status.json` snapshot (11 buckets in real data, 5 in v4.7.0 parser). | 2026-05-07 |
| C4 | Performance/Reliability | What happens when multiple Claude Code sessions trigger concurrent cache writes? | **Last-writer-wins + parse-fail-self-heal.** No file lock. Writes use tmp+rename (atomic on POSIX). Windows EBUSY retries once after 50ms, then falls back to direct write. Reads on corrupt JSON treat as no cache → trigger fresh probe. Probe idempotency makes write-write races harmless (identical results in 3-minute window). No new dependency for file locking — would violate NFR-4. | 2026-05-07 |
| C5 | Completion Signals | How are tests written without a live OAuth token in CI? | **Extend the existing stdin-mock pattern from v4.7.0.** Three new mock fields injectable via stdin JSON: `_mock_probe_response` (replaces HTTP probe — returns given `{status, headers, body}`), `_mock_topology` (overrides env-vars seen by topology resolver), `_mock_now_ms` (pins clock for cache TTL state-machine tests). Tests build fixture JSON, pipe it to `node scripts/statusline.js`, snapshot-compare stdout. No new HTTP-interceptor dependency (NFR-4 preserved). Pattern is the natural extension of v4.7.0's `_mock_rate_limits` / `_mock_profile` / `_mock_cache_fix` injection. | 2026-05-07 |

## Overview

Replace v4.7.0 statusline's hard-coded `api.anthropic.com/api/oauth/usage` call with a single minimal `POST /v1/messages` request through whatever endpoint Claude Code itself uses, then parse `anthropic-ratelimit-unified-*` headers from the response.

**Topology-agnostic by default.** Default path = native Anthropic API (`api.anthropic.com`) with the user's OAuth token from `~/.claude/.credentials.json` — exactly what Claude Code does without proxy. CPA, cache-fix, and any other proxy in the chain are **optional presences detected at runtime**, not required components. The implementation MUST work correctly in three independent cases:
- **Native** (no proxy): probe target = `api.anthropic.com`, auth = OAuth token from credentials.json
- **CPA** (or any Anthropic-compatible proxy): probe target = `$ANTHROPIC_BASE_URL`, auth = `$ANTHROPIC_AUTH_TOKEN` — pure runtime substitution, no project-side knowledge of CPA-specific behaviour
- **Cache-fix in chain** (locally or upstream): no special handling — probe path is unchanged; cache-fix-only extras (TTL/hit-rate) are merged when files happen to be fresh, ignored otherwise

No CPA-specific code paths beyond reading the env vars Claude Code itself reads. No CPA management API. No proxy-specific dependencies. The project ships a statusline for Claude Code users — the proxy is the user's environment choice, not our problem to model.

## Context

Statusline v4.7.0 was authored against a topology assumption that does not survive proxy use: it calls `api.anthropic.com/api/oauth/usage` directly with an OAuth token from `~/.claude/.credentials.json`. When `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` env vars are set (CPA-mode), Claude Code skips OAuth flow entirely — the cached OAuth token never refreshes, expires after ≈24h, and the statusline silently degrades to fake zeros.

> **Evidence anchor (FM-10 guard):** *"contentbricks-universal на этой машине внезапно стал куцым, возможно, после перенаправления на cliproxyapi вместо прямого доступа"* (Q-1) — direct user observation of the failure mode driving this spec.

The user articulated the correct architecture in one sentence: *"statusline должен ходить туда, куда ходит claude. не «ручками искать oauth token», а понимать, когда у нас прямой oauth, когда прокси, когда, как сейчас прокси (claude cache fix proxy) через прокси (cliproxyapi)"* (Q-4). Combined with Q-5 (*"забирать инфу… чисто через api"*), Q-7 (*"никуда мы лазить за токеном не будем"*), and Q-8 (*"что отдает cpa в anthropic based ответах"*), the boundary is unambiguous: runtime API path, no token theft, response-side data.

CPA was empirically and source-verified to forward `anthropic-ratelimit-unified-*` headers verbatim. The source `header_filter.go` blocks only hop-by-hop headers and AI-gateway prefixes (`x-litellm-`, `helicone-`, `x-portkey-`, `cf-aig-`, `x-kong-`, `x-bt-`); Anthropic ratelimit headers are not in any blocklist. The user's local `~/.claude/quota-status.json` from 2026-05-01 contains the full `anthropic-ratelimit-unified-*` header set, captured by cache-fix while it was running through the CPA chain — empirical proof of pass-through.

## Domain Modeling

DDD evaluated — not needed. Rationale: this is a runtime IO substitution feature (one HTTP source replaces another), not a domain-modeling exercise. No project-owned entities, no state machines beyond a freshness 3-state enum (FRESH/STALE/UNAVAILABLE), no business invariants. C3/C9 entity-counting yields zero domain entities. FR-D3 detection regexes find no matches in Context above.

## Functional Requirements

### FR-1: Walk the user's runtime path — native-first, proxy-agnostic

The statusline MUST resolve the upstream target from `process.env.ANTHROPIC_BASE_URL`, **falling back to `https://api.anthropic.com` when unset (the default native case)**. The auth token MUST be resolved by reading, in order: `ANTHROPIC_AUTH_TOKEN` env, `ANTHROPIC_API_KEY` env, then `~/.claude/.credentials.json` `claudeAiOauth.accessToken`. This mirrors Claude Code's own resolution order — guaranteeing same path, same auth.

**Native is the baseline, not a special case.** When neither env var is set, the statusline MUST behave identically to a vanilla Claude Code installation: hit `api.anthropic.com` with the OAuth token from credentials.json. CPA, cache-fix, or any other proxy is detected purely by env-var presence — no proxy-specific code paths, no proxy-aware probing, no proxy SDKs. The implementation MUST contain zero string-literal references to "cpa", "cliproxyapi", "cache-fix", or other proxy-specific names in core logic (these names appear only in user-facing diagnostic hints when relevant).

**Evidence:**

> Q-4: *"statusline должен ходить туда, куда ходит claude. не «ручками искать oauth token», а понимать, когда у нас прямой oauth, когда прокси, когда, как сейчас прокси (claude cache fix proxy) через прокси (cliproxyapi)."*

> Q-9 (clarification turn): *"очевидно же, надеюсь, что мы не привязываемся жестко к CPA в проекте? есть CPA и cache fix — хорошо, нет ничего — делаем стандартные запросы к стандартному api."*

I read `scripts/statusline.js` v4.7.0 lines 195–220 and 333–365 with the Read tool — the OAuth/profile and OAuth/usage requests both hard-code `hostname: 'api.anthropic.com'` inside the spawned `https.request` script. I verified empirically that `process.env.ANTHROPIC_BASE_URL = 'http://unleashed.lan:8321'` is set on the user's box (PowerShell `$env:ANTHROPIC_BASE_URL` returned the URL). The hard-coded host bypasses that env override — that is the defect FR-1 corrects. The fix targets any proxy via the same env-var contract, including the no-proxy case where the env var is unset and the statusline falls through to `api.anthropic.com` naturally.

### FR-2: Quota probe via Messages API response headers

The statusline MUST issue a single minimal `POST {target}/v1/messages` per cache-miss, using the resolved auth token. The request body MUST be the smallest billable form: `{"model": "<minimal>", "max_tokens": 1, "messages": [{"role":"user","content":"."}]}`.

**Header parsing — pass-through-unknown contract (per C3):** The parser MUST capture every header matching `^anthropic-ratelimit-unified-(.+)-utilization$` (case-insensitive) and pair each with its corresponding `*-reset`, `*-status`, and `*-surpassed-threshold` headers when present. Known bucket names project onto canonical fields:

| Header bucket | Canonical field |
|---------------|-----------------|
| `5h` | `five_hour` |
| `7d` | `seven_day` |
| `7d_sonnet` | `seven_day_sonnet` |
| `7d_opus` | `seven_day_opus` |
| `7d_omelette` | `seven_day_omelette` |
| `overage` | `extra_usage` (utilization-only) |

Bucket names not in this table MUST be preserved verbatim under `quotas[<bucket-name>]` in the parsed result. Renderer reads only canonical fields; unknown buckets are kept in cache for future-render use without breaking the present render. I read `~/.claude/quota-status.json` (snapshot from 2026-05-01) and counted 11 distinct buckets in `data` keys (`five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_sonnet, seven_day_cowork, seven_day_omelette, tangelo, iguana_necktie, omelette_promotional, extra_usage`). The v4.7.0 parser drops 6 of those silently — pass-through prevents the same defect from re-appearing when Anthropic adds the next bucket.

**Evidence:** Q-5 *"забирать инфу… чисто через api"*; Q-8 *"что отдает cpa в anthropic based ответах хотя бы usage"*.

### FR-3: No token theft, no auth-files traversal

The statusline MUST NOT read CPA management endpoints, MUST NOT call `/v0/management/auth-files*`, MUST NOT extract OAuth tokens from any storage other than the user's own `.credentials.json` (when no env-token is present and the topology is native). Bearer auth MUST come exclusively from env-vars or the user's own credentials — never from a third-party proxy's storage.

**Evidence:** Q-7 *"никуда мы лазить за токеном не будем"*; Q-4 *"не «ручками искать oauth token»"*.

### FR-4: Probe model fallback chain

The statusline MUST select the probe model from a hardcoded fallback list of cheapest-tier models (e.g., `claude-haiku-4-5`, `claude-haiku-3-5`, `claude-3-5-haiku-20241022`). On the first probe in a session (cache empty for model name), the statusline MUST iterate the list and persist the first non-error model to the on-disk cache as `probe_model`. Subsequent probes use the persisted value until it returns a model-not-found error, then re-iterate. This handles CPA dispatchers that may not wire all Haiku variants.

**Evidence:** Q-2 *"почему деградировали все блоки на дефолтные и как чинить"* (the user wants quotas to work, and the diagnostic confirmed CPA returned 502 on `claude-haiku-4-5` in synthetic probe — likely model-name dispatch issue).

### FR-5: Cache contract — separate fresh-TTL from stale-window

The statusline MUST cache the parsed probe result on disk at `~/.claude/.contextbricks-quota-cache.json` (mode 0600). The cache MUST distinguish two timeframes:
- **Fresh window:** age < 180s → return cached, `freshness=FRESH`
- **Stale window:** 180s ≤ age < 24h, with current probe failing → return cached, `freshness=STALE`, age surfaced in render
- **Expired:** age ≥ 24h or no cache → null result (NullSource hint)

Removes v4.7.0's `MAX_STALE_MS=5h` which conflated the 5h Anthropic rolling-window with the cache's stale-fallback TTL — these are independent concerns.

**Evidence:** Q-1 *"внезапно стал куцым"* (the 4-day-stale cache was silently dropped because of the conflated TTL — observed failure); Q-2 *"как чинить"*.

### FR-6: Honest staleness rendering

When `freshness !== FRESH`, the rendered Line 4 MUST visibly indicate staleness with a dim suffix `(stale Xh Ym)` after the last quota segment. When `freshness === UNAVAILABLE` (no source produced data), the quota segments MUST be replaced with a single dim hint message describing the failure mode. Faking zero utilization for stale data is FORBIDDEN; v4.7.0's `expireResetLimits()` MUST be removed.

**Evidence:** Q-2 *"почему деградировали все блоки на дефолтные"* — the user explicitly noticed and complained about exactly this fake-default rendering.

### FR-7: Cache-fix optionality preserved

When `~/.claude/claude-meter.jsonl` or `~/.claude/quota-status.json` (modern cache-fix) is fresh AND the response-header probe succeeded, the statusline MAY merge cache-fix-only extras (TTL tier, hit rate, PEAK flag, OVERAGE marker) into the rendered output, exactly as v4.7.0 does. When cache-fix is absent, these extras MUST be silently omitted — they MUST NOT block primary quota rendering.

**Evidence:** Q-6 *"Cache-fix опционален"*; Q-4 *"когда у нас прямой oauth, когда прокси, когда прокси через прокси"* (cache-fix is one of the topology variants, not a hard dep).

### FR-8: Failure-mode taxonomy

The statusline MUST classify probe outcomes into a finite enum and emit a topology-specific hint per outcome:

| Outcome | Hint message |
|---------|--------------|
| No auth in env or creds | `[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]` |
| Probe 401/403 | `[auth token rejected — refresh credentials]` |
| Probe 5xx series | `[API unreachable — service degraded]` |
| Probe returns 200 but no `anthropic-ratelimit-*` headers | `[probe returned no ratelimit headers]` |
| Probe model not found (chain exhausted) | `[no compatible probe model in upstream]` |

The hint message MUST be the rendered content of Line 4 when `freshness === UNAVAILABLE`. No fake zeros.

**Evidence:** Q-2 *"как чинить"* (user needs the diagnostic output to make the fix obvious); Q-3 *"возможно, cpa режет какие-то важные headers"* (the ratelimit-headers-missing hint catches exactly this hypothesis).

### FR-9: Token confidentiality — secrets never persist beyond process memory

The statusline MUST NOT write any of the following into the cache file, hint messages rendered to the terminal, or any log/stderr output: bearer token values (full or partial), `Authorization` header strings, raw response body from probe (which may echo headers in error responses), full upstream response headers (only parsed `anthropic-ratelimit-unified-*` values are extracted and stored — never the raw header set), env-var dumps, or process argv.

**Three concrete invariants:**

| Invariant | Required behaviour |
|-----------|--------------------|
| Cache file content (`~/.claude/.contextbricks-quota-cache.json`, mode 0600) | Stores only parsed quota values + freshness enum + age_ms + source_id + hint_kind enum (one of 5 FR-8 values) + persisted probe model name. Bytes for any other category MUST NOT be written. |
| Hint messages on Line 4 | Literal strings from FR-8 enum. No string interpolation that injects token values, header values, or response body. |
| Process stderr / stdout (non-render) | Silent on any probe failure. No `console.error(err)` on a token-bearing object. Quiet fall-through to NullSource is the only legal failure path. |

**Token transport to subprocess:** The bearer token MUST be passed via `env: { ANTHROPIC_TOKEN: token }` to `spawnSync`, NEVER via argv (where `ps` would expose it). I read `scripts/statusline.js:225-247` (current `fetchUserProfile`) and `scripts/statusline.js:333-388` (current `fetchUsageData`) with the Read tool — both already use the env-var pattern in v4.7.0. FR-9 codifies this as a non-negotiable inheritance, not a new behaviour.

**Evidence:**

> Q-7 (turn 4): *"никуда мы лазить за токеном не будем, с ума сошел что ли?"*

I extended Q-7's user-stated boundary about token theft from external storage to a symmetric boundary about token leakage into our own statusline artefacts. The symmetry is: a statusline that reads tokens carefully but writes them carelessly into screenshotted hint messages or git-committed dotfiles re-creates the same exposure surface the user explicitly rejected.

## Non-Functional Requirements

### NFR-1: Probe cost — strict bounding

A single probe MUST consume ≤ 10 input tokens + ≤ 1 output token (using `max_tokens: 1`). At 180s cache TTL the rate is ≤ 20 probes/hour ≤ 480 probes/day. Daily marginal cost on Haiku tier MUST stay under $0.001/day. Daily marginal session-quota cost MUST stay under 0.5% of typical 5h session.

### NFR-2: Probe latency budget

A single probe MUST complete or time out within 4000 ms (matches v4.7.0 `fetchUsageData` timeout). Statusline render MUST NOT block on probe — the existing on-disk cache covers concurrent renders.

### NFR-3: Backwards compatibility

Native-OAuth topology (no CPA env vars, fresh OAuth token in credentials.json) MUST continue to render identically to v4.7.0 — same OAuth-usage data shape, same Line 4 output. Existing env-var contract (`CONTEXTBRICKS_*`) MUST be preserved without removal. New env vars MUST default to behaviour-preserving values when unset.

### NFR-4: No new external dependencies

The implementation MUST NOT introduce npm dependencies. HTTP calls continue using `spawnSync(node, ['-e', script])` (already in v4.7.0) for security-equivalent behaviour. (Migrating to native `fetch` is explicitly Out of Scope — separate CR.)

### NFR-5: Cache file safety — last-writer-wins, parse-fail-self-heal (per C4)

On-disk cache file MUST be written with mode 0600. Cache writes MUST follow this contract:

| Concern | Required behaviour |
|---------|--------------------|
| POSIX writes | tmp+rename (kernel-atomic). Reader either sees pre-rename version or post-rename version, never partial. |
| Windows writes | tmp+rename first; on `EBUSY` (destination open by another reader), retry once after 50ms; on second failure, fall back to direct write to destination. |
| Concurrent writers (multiple Claude Code sessions) | Last-writer-wins. No file lock, no `proper-lockfile`-style dependency (would violate NFR-4 no-new-deps). Probe idempotency in 3-minute window makes the race harmless: both writers compute approximately identical headers and persist the same data. |
| Reader on corrupt JSON | Treat as no cache → trigger fresh probe → write fresh result. Self-heals within one render. |
| Partial-write failures | Silent tolerance, fall through to NullSource for the current render. Existing pattern from v4.7.0 preserved. |

I read `~/.claude/settings.json` with the PowerShell tool; `enableAllProjectMcpServers: true` and worktree-tooling presence indicate the user runs multiple Claude Code sessions concurrently — making concurrent-render contention an in-practice scenario, not theoretical. The chosen contract (last-writer-wins + self-heal) handles it without per-process coordination.

### NFR-6: Test coverage — stdin-mock-driven (per C5)

Unit tests MUST cover: header parser (≥ 10 shape variations including pass-through-unknown buckets per C3), cache TTL state machine (FRESH / STALE / UNAVAILABLE transitions per C4), failure-mode hint mapping (all 5 outcomes from FR-8), model fallback chain (FR-4).

Integration tests MUST cover ≥ 5 stdin-fixture scenarios — native-fresh, native-expired, proxy-happy, proxy-5xx-all-models, no-config — implemented via the **stdin-mock contract** (extension of v4.7.0 pattern):

| Mock field | Effect | Use in fixture |
|------------|--------|----------------|
| `_mock_probe_response` | Replaces HTTP probe with `{status, headers, body}` from fixture. | Sets ratelimit headers per scenario; produces 5xx for failure-mode test. |
| `_mock_topology` | Overrides env-vars seen by `TopologyDetector` before resolution. | Pin `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` per fixture without polluting CI shell env. |
| `_mock_now_ms` | Pins the time source. | Drive cache TTL state-machine transitions deterministically (age 100 ms / 200 ms / 25 h). |

Test runner pipes fixture JSON to `node scripts/statusline.js`, captures stdout, snapshot-compares against `expected.txt`. I read v4.7.0 `scripts/statusline.js:169, 304, 716` with the Read tool and verified the existing `getPath(input, '_mock_*')` pattern — the new fields slot into the same dispatch without architectural change. No new dev-dependency (`nock`/`msw`/`undici-mock`) — NFR-4 holds.

## User Stories

### US-1: Multi-machine power user under CPA — Line 4 just works (P1)

**As a** power user who routes Claude Code through CLIProxyAPI on a LAN-shared host so all machines share one Max subscription,
**I want** the statusline to display real-time quota burn from response headers without per-machine OAuth setup,
**so that** I can see session/week pacing on every machine without manually re-authenticating Claude Code or running a sidecar proxy.

**Evidence:** Q-1 *"внезапно стал куцым после перенаправления на cliproxyapi"*; Q-4 *"должен ходить туда, куда ходит claude"*.

**Acceptance Criteria:**
- [ ] On a fresh machine with `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` set, statusline renders Line 4 with full quota segments within 4s of first invocation
- [ ] Without any env-var or credentials.json setup beyond what Claude Code already requires, no extra config files created or env vars asked
- [ ] Switching machines (different topology) shows consistent Line 4 quality — no per-machine display drift

### US-2: Honest degradation when upstream broken (P1)

**As a** user whose CPA is misbehaving (502, model-not-found, network down),
**I want** the statusline to show a specific diagnostic hint instead of fake zeros,
**so that** I can immediately tell what to fix instead of debugging a "why is it broken" mystery.

**Evidence:** Q-2 *"почему деградировали все блоки на дефолтные и как чинить"*; Q-3 *"возможно, cpa режет какие-то важные headers"*.

**Acceptance Criteria:**
- [ ] On 5xx probe response, Line 4 displays `[API unreachable — service degraded]` (dim) — not zero-filled segments
- [ ] On missing `anthropic-ratelimit-*` headers, Line 4 displays `[probe returned no ratelimit headers]` — distinguishable from auth failure
- [ ] Each failure mode in FR-8 produces a distinct, copy-pasteable hint string

### US-3: Stale-cache visibility (P2)

**As a** user whose network just dropped or whose CPA briefly returned 502,
**I want** the statusline to keep displaying the last-known quotas with a clear staleness indicator,
**so that** I have continuity in my pacing display while diagnosing transient upstream issues.

**Evidence:** Q-2 *"как чинить"* — implies wanting context-preserving display during diagnosis.

**Acceptance Criteria:**
- [ ] When probe fails but cache age < 24h, Line 4 renders the cached quotas with `(stale Xh Ym)` suffix, dim color
- [ ] After 24h of probe failures, the stale-cache fallback expires; Line 4 transitions to UNAVAILABLE hint
- [ ] Recovery from a transient failure clears the suffix on the next successful probe

### US-4: Native-OAuth user — no behavior change (P2)

**As a** user on a dev machine without any proxy (native Claude Code OAuth),
**I want** the statusline to behave exactly as v4.7.0 did,
**so that** the upgrade does not require any per-machine adjustment for already-working setups.

**Evidence:** NFR-3 (backwards compatibility) — derived from the user's broader need to roll out one package across heterogeneous fleet.

**Acceptance Criteria:**
- [ ] On a machine with no `ANTHROPIC_BASE_URL` set and a fresh OAuth token in credentials.json, Line 4 output matches v4.7.0 byte-for-byte (excluding the `(stale)` suffix when freshness=FRESH, which is absent)
- [ ] Existing env vars (`CONTEXTBRICKS_*`) continue to behave per v4.7.0 docs

### US-5: No-token machine — graceful zero-config message (P3)

**As a** user on a machine where Claude Code is not configured at all (no env, no credentials),
**I want** the statusline to display a one-line setup hint,
**so that** I know what's missing without seeing a broken-looking blank Line 4.

**Acceptance Criteria:**
- [ ] On a machine with no auth source at all, Line 4 displays `[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]`
- [ ] No probe attempt is made (cost-zero on this state)

## Edge Cases

- **CPA returns 502 on every model in fallback chain:** UNAVAILABLE with `[no compatible probe model in upstream]` hint after exhausting list. Statusline does NOT retry mid-render — next render after 180s cache TTL will retry.
- **Probe 200 with empty body and no headers:** classify as `probe returned no ratelimit headers`, treat as UNAVAILABLE. Don't poison cache with zero-data result.
- **Probe 429 (rate-limited):** read `Retry-After` if present; treat cached data (if age < 24h) as STALE and respect Retry-After before next probe.
- **`ANTHROPIC_BASE_URL` set to `https://api.anthropic.com` literally:** treat as native (no special handling). Probe target normalization strips trailing slash.
- **Multiple Anthropic accounts in `.credentials.json`:** v4.7.0 behavior preserved — read `claudeAiOauth.accessToken` only. Multi-account support is Out of Scope.
- **Concurrent renders write cache simultaneously:** atomic tmp+rename per NFR-5; readers either see old or new version, never corrupt.
- **Clock skew between user machine and Anthropic:** `resets_at` parsing tolerates ±5min skew (existing v4.7.0 behavior preserved).
- **`anthropic-beta` header rejected by some upstream:** retry without `anthropic-beta` header on first 4xx, persist working header set in cache. Out of Scope for v1 — implement only if FR-8 hints reveal this in production.
- **CPA strips Anthropic ratelimit headers in future version:** classify as `probe returned no ratelimit headers`, emit hint, do NOT silently degrade. User can act on the hint.
- **Cache file corrupted (manual edit, disk error):** parse failure → treat as no cache, retry probe.
- **Probe model name returns 404:** advance to next in chain, persist working name. If chain exhausted, emit `[no compatible probe model in upstream]`.

## Out of Scope

- **Migrating from `spawnSync(node, ['-e'])` to native fetch.** Separate CR; orthogonal optimization.
- **OAuth token refresh from statusline.** Statusline never writes credentials.json — too racy from per-render. Refresh remains Claude Code's job.
- **Reading CPA management endpoints (`/v0/management/auth-files`).** Explicitly rejected per Q-7. Token-theft architecture is not a path.
- **Forking CLIProxyAPI or claude-code-cache-fix.** Both rejected; we read forwarded headers, not modify the upstream.
- **Writing a new sidecar process for quota aggregation.** Approach C from brainstorm; not needed once response-header source proves out.
- **Claude Code `/api/oauth/profile` replacement for @username under CPA.** Existing 24h profile-cache fallback is sufficient for v1. If future user evidence shows breakage, separate CR.
- **Multi-account Anthropic support.** Single active account per machine, matching Claude Code's own model.
- **Configurable probe model list.** Hardcoded fallback chain in v1. If users hit `no compatible probe model` regularly, reconsider.
- **Live `anthropic-ratelimit-tokens-*` headers (per-token bucket).** Not needed for the user's pacing use case (utilization 0..1 ratios suffice).
- **Pacing/burn changes.** Existing v4.7.0 burn computation logic is preserved, only the data source changes.
- **Migration of v4.7.0 cache files** (`.usage-cache.json`, `.profile-cache.json`). Per C1: leave them on disk untouched. v5.0 reads/writes only the new cache file (`.contextbricks-quota-cache.json`). No postinstall delete, no shape conversion. Mtime of v4.7.0 files becomes irrelevant — they sit as ≤2KB orphans like every other dotfile in `~/.claude/`.

## Dependencies

- **External services:** Anthropic Messages API (via direct or proxied path). No new vendor.
- **Existing code:** `scripts/statusline.js` v4.7.0 (refactor target). `scripts/lib/` directory created.
- **No new npm dependencies.** Uses Node built-ins (`https`, `child_process`, `fs`, `path`).
- **Test runtime:** Node test runner (already in v4.7.0 dev workflow).
- **Environment knowledge:** `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` already used by Claude Code — statusline reads same vars.

## Success Criteria

- [ ] On the user's diagnostic machine (CPA topology, no fresh OAuth, no cache-fix running), statusline renders Line 4 with real Anthropic ratelimit data — no fake zeros, no per-machine config
- [ ] On a native-OAuth dev machine, Line 4 output is byte-identical to v4.7.0 (same shape, same data, same colors)
- [ ] When the user disconnects network mid-session, Line 4 transitions to `(stale Xm)` suffix within 180s of the next render — never to fake zeros
- [ ] Marginal API cost added by statusline ≤ $0.001/day, ≤ 0.5% of session quota
- [ ] All FR-8 failure-mode hints reproducible in integration tests
- [ ] Existing v4.7.0 env vars (`CONTEXTBRICKS_*`) work unchanged on existing user setups (no breaking change)

## Open Questions

1. **`[NEEDS CLARIFICATION]` — Diagnostic-mode 502 from CPA on `claude-haiku-4-5`.** Synthetic probes during design returned 502 across 3 attempts; real Claude Code requests succeed. Hypothesis: CPA's model dispatcher does not have `claude-haiku-4-5` registered for the user's account/profile. Confirmation requires either (a) Claude Code request log showing what model name actually flows through CPA, or (b) CPA `/v0/management/api-key-usage` review. Resolution before /nvmd-plan: try alternative models (`claude-3-5-haiku-20241022`, `claude-haiku-3-5`) against the user's `unleashed.lan:8321` to validate the fallback chain works in practice. Falls within FR-4 fallback design — implementation will surface the answer empirically.

2. **`[NEEDS CLARIFICATION]` — Should probe send `anthropic-beta: oauth-2025-04-20` or `anthropic-beta: claude-code-20250219` or both?** v4.7.0 uses `oauth-2025-04-20` for OAuth API. Messages API may need a different beta header in CPA-mode where the bearer is a CPA api-key, not OAuth. Resolution: implementation tries with `claude-code-20250219` first (matches Claude Code's actual request), falls back to no-beta on 4xx. Implementation detail, not a spec gap.

3. **`[NEEDS CLARIFICATION]` — Profile fetching (Line 1 @username) under CPA — keep current 24h file-cache fallback, or extend response-header approach?** v4.7.0 `fetchUserProfile` calls `api/oauth/profile` directly. Under CPA this likely 404s. Existing file-cache covers 24h; longer absence shows no @username. Acceptable for v1? — Yes, by NFR-3 backward-compat. Defer to follow-up CR if the user explicitly reports the missing-@username gap.

<!-- non-trivial feature: 6-section taxonomy fully present (FR/NFR/User Stories/Edge Cases/Out of Scope/Dependencies/Success Criteria) -->
