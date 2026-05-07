# Implementation Tasks — F-001 / CR-001-initial-scope

> **Feature:** topology-aware-quota
> **CR:** CR-001-initial-scope
> **Spec:** spec.md • **Plan:** plan.md • **Checklist:** checklists/requirements-quality.md (PASS)
> **Generated:** 2026-05-07

Dependency-ordered task list. `[P]` markers carry provenance (`PARALLEL-WITH:`). `GATE-N` tasks are non-skippable verification points between phases. Each task has explicit acceptance criteria and verification evidence.

---

## Legend

- `[P]` — parallel-eligible per Phase 0.5 file-distinctness verification
- `GATE-N` — verification gate; downstream tasks block until GATE passes
- AC = Acceptance Criteria (binary pass/fail)
- VE = Verification Evidence (artifact proving AC met)

---

## Phase 1 — Skeleton (US-1 foundation, US-4 baseline)

### T1: Extract `detectTopology` into `scripts/lib/topology.js` `[P]`

**PARALLEL-WITH:** T2 T3 — distinct files verified (Phase-1 setup, no shared state)

**Touches:**
- create `scripts/lib/topology.js`
- create `scripts/test/topology.test.js`

**Maps to:** FR-1

**AC (committed `30df69d`, 12/12 tests pass):**
- [x] `detectTopology(env, fsAccess)` exported, returns `{ target, authToken, authSource }` shape per plan §Data Model
- [x] `target` resolves: `env.ANTHROPIC_BASE_URL` → fallback `'https://api.anthropic.com'`; trailing slash stripped
- [x] `authToken` resolves in order: `env.ANTHROPIC_AUTH_TOKEN` → `env.ANTHROPIC_API_KEY` → `readCredsToken(fs)` → `null`
- [x] `authSource` reflects which source supplied the token (string or `null`)
- [x] Function is pure: no I/O outside the `fsAccess` argument; no global `process.env` reads outside the `env` argument
- [x] Zero string-literal references to `cpa|cliproxyapi|cache-fix` in `topology.js` (FR-1 enforcement)

**VE:**
- `node --test scripts/test/topology.test.js` passes ≥8 cases:
  1. Native (no env, no creds) → `{ target: api.anthropic.com, authToken: null, authSource: null }`
  2. Native (no env, fresh creds) → `authToken` from creds
  3. Proxy via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` → both env values used
  4. Proxy with trailing slash in URL → stripped
  5. `ANTHROPIC_API_KEY` only (no `ANTHROPIC_AUTH_TOKEN`) → fallback to `ANTHROPIC_API_KEY`
  6. `ANTHROPIC_AUTH_TOKEN` set + creds also valid → env wins
  7. `ANTHROPIC_BASE_URL = 'https://api.anthropic.com'` literal → treated as native (no special path)
  8. Empty string env-var → treated as unset (falsy)

---

### T2: Build `quota-parser.js` (header → shape) `[P]`

**PARALLEL-WITH:** T1 T3 — distinct files verified

**Touches:**
- create `scripts/lib/quota-parser.js`
- create `scripts/test/quota-parser.test.js`

**Maps to:** FR-2, C3

**AC (committed `5c26c73`, 13/13 tests pass):**
- [x] `parseRateLimitHeaders(headers)` exported
- [x] Captures `^anthropic-ratelimit-unified-(.+)-utilization$` regex (case-insensitive)
- [x] Pairs each utilization with sibling `*-reset` and `*-status` headers
- [x] Maps known buckets to canonical fields per plan §API Contracts table (5h, 7d, 7d_sonnet, 7d_opus, 7d_omelette, overage)
- [x] Unknown buckets preserved verbatim under `quotas[bucket-name]`
- [x] Missing reset → field still present with `resets_at: null`
- [x] Returns empty `QuotaData` on no-matching-headers (not throw)

**VE:**
- `node --test scripts/test/quota-parser.test.js` passes ≥10 cases:
  1. All 6 known buckets present → 6 canonical fields populated
  2. New bucket `7d_haiku` → preserved under `quotas['7d_haiku']`
  3. Empty headers → `{}` (no throw)
  4. Mixed-case header keys (`Anthropic-Ratelimit-Unified-5H-Utilization`) → normalized
  5. `*-utilization` without sibling `*-reset` → entry present with `resets_at: null`
  6. Malformed numeric (`utilization: "abc"`) → bucket dropped, others preserved
  7. The 11-bucket fixture from `quota-status.json` snapshot → all 11 preserved (6 canonical + 5 in `quotas`)
  8. Status field captured when present (`status: "allowed_warning"`)
  9. Resets parsed as either ISO 8601 or unix-seconds string
  10. Headers with `anthropic-ratelimit-tokens-*` (different namespace) → ignored

---

### T3: Extract `creds.js` + `detect-term-width.js` `[P]`

**PARALLEL-WITH:** T1 T2 — distinct files verified

**Touches:**
- create `scripts/lib/creds.js` (extract from current `statusline.js:128-161`)
- create `scripts/lib/detect-term-width.js` (extract from current `statusline.js:803-819`)
- create `scripts/test/creds.test.js`

**Maps to:** FR-1 (token resolution), preserved v4.7.0 behaviour for terminal width

**AC (committed `0377605`, 13/13 tests pass):**
- [x] `readOAuthToken(fsAccess)` returns string or null (existing v4.7.0 semantics preserved)
- [x] `readCredentialsExpiresAt(fsAccess)` exported (new helper, returns ms or null)
- [x] `detectTermWidth()` extracted as-is, public export
- [x] No semantic change to either — existing v4.7.0 behaviour byte-identical

**VE:**
- `node --test scripts/test/creds.test.js` passes ≥4 cases (creds.json present, missing, malformed JSON, missing `claudeAiOauth.accessToken`)
- Manual verification: `statusline.js` post-T6 produces same output as v4.7.0 on a native fixture

---

### GATE-1: Phase 1 smoke test (PASSED 2026-05-07)

**Blocks:** T4 onward

**AC:**
- [x] T1, T2, T3 all merged (commits `30df69d`, `5c26c73`, `0377605`)
- [x] All Phase 1 tests pass (38/38 combined)
- [x] No semantic regression in `scripts/statusline.js` v4.7.0 baseline (still renders Lines 1-3)

**VE:** CI green; manual statusline run produces v4.7.0-identical output (orchestrator not yet rewired).

---

## Phase 2 — Header-probe source (US-1 P1 lands)

### T4: Implement `HeaderProbeQuotaSource` + `NullSource`

**Maps to:** FR-2, FR-4, FR-5, FR-8, FR-9, NFR-1, NFR-2, NFR-5, C2, C4

**Sequential** — depends on T1, T2, T3.

**Touches:**
- create `scripts/lib/quota-source.js`
- create `scripts/test/quota-source.test.js`

**AC (committed `33d8ee0` + `73a8b6f` GATE-2 fix, 15/15 tests pass):**
- [x] `HeaderProbeQuotaSource` exported with `fetch(nowMs)` method per plan §Key Algorithms
- [x] HTTP probe via `spawnSync(node, ['-e', script])` — token passed via `env: { ANTHROPIC_TOKEN }`, NEVER argv (FR-9 invariant)
- [x] Probe model fallback chain: `CONTEXTBRICKS_QUOTA_PROBE_MODEL` env first, then cached working model, then `['claude-haiku-4-5', 'claude-haiku-3-5', 'claude-3-5-haiku-20241022']`. First non-error model persisted to cache `probe_model` field
- [x] Anthropic-beta header chooser: try `'claude-code-20250219'` first; on 4xx (non-model-not-found), fall back to no-beta; persist working header set
- [x] Cache freshness state machine: <180s FRESH, <24h STALE (probe failure with cached data), ≥24h drop
- [x] Atomic write: tmp+rename on POSIX; Windows EBUSY retry once after 50ms then direct write fallback (C4)
- [x] Parse-fail-self-heal: corrupt cache JSON → treat as no cache → trigger fresh probe
- [x] `NullSource.fetch()` returns `{ data: null, freshness: "UNAVAILABLE", hint_kind }` per FR-8 enum
- [x] Cache record contains ONLY: `data`, `timestamp_ms`, `probe_model`, `schema_version`, `anthropic_beta`. Never raw bodies, raw headers, env dumps, token (FR-9)
- [x] No string-literal references to proxy names (word-boundary) in `quota-source.js`

**VE:**
- `node --test scripts/test/quota-source.test.js` passes ≥12 cases:
  1. Cache hit, age < 180s → no probe, returns FRESH
  2. Cache miss → probe → 200 OK with headers → returns FRESH, cache written
  3. Cache stale (age 5min), probe 5xx → returns STALE with cached data
  4. Cache stale (age 25h), probe 5xx → returns null (UNAVAILABLE)
  5. Probe 401 → NullSource hint_kind="auth-rejected"
  6. Probe model not found 4xx → advances chain, persists working name
  7. All probe models 4xx → NullSource hint_kind="no-model"
  8. Probe 200 with empty headers → NullSource hint_kind="no-headers"
  9. No auth token → NullSource hint_kind="no-auth", no probe attempted
  10. Concurrent-write simulation: two parallel writes → last-writer-wins, cache valid JSON
  11. Corrupt cache JSON → silent re-probe
  12. Token NEVER appears in cache content (grep `Bearer|sk-` returns 0)

---

### GATE-2: Phase 2 user-acceptance smoke (PASSED 2026-05-07)

**Blocks:** T5 onward

**AC:**
- [x] T4 merged, all unit tests pass (commits `33d8ee0` + `73a8b6f`)
- [x] Manual run on user's `unleashed.lan:8321` — initial chain (haiku) returned 502 "unknown provider"; Branch A applied (env override); retest with `claude-opus-4-6` → 200 OK + 13 anthropic-ratelimit headers (real account quotas). Open Q1 RESOLVED.
- [x] Branch A (env override) shipped in commit `73a8b6f`. Evidence: `.agent/specs/topology-aware-quota/evidence/gate-2-probe-result.txt`

**VE:** Probe response saved to `.agent/specs/topology-aware-quota/evidence/phase-2-probe-result.txt` (or `phase-2-probe-failure.txt` if Branch B/C invoked).

---

## Phase 3 — (folded into T4 cache half)

Phase 3 deliverables (cache state machine, atomic write contract, parse-fail-self-heal) are integrated within T4 to keep `quota-source.js` cohesive. No separate task — covered by T4 AC items 5-8 and 11.

---

## Phase 4 — Renderer integration + remove `expireResetLimits` (US-4 byte-identity)

### T5: Refactor render layer (`rate-view.js` + `format/*.js`) and remove `expireResetLimits`

**Maps to:** FR-6, FR-7, NFR-3, US-4

**Sequential** — depends on T2 (parser), T4 (source).

**Touches:**
- create `scripts/lib/rate-view.js` (extract + refactor from current `statusline.js:533-602`)
- create `scripts/lib/format/rate-limit-line.js` (extract from `statusline.js:643-703`)
- create `scripts/lib/format/ttl-prefix.js` (extract from `statusline.js:606-613`)
- create `scripts/lib/format/extras-tail.js` (extract from `statusline.js:617-628`)
- create `scripts/test/rate-view.test.js`, `scripts/test/format/rate-limit-line.test.js`
- delete `expireResetLimits` from `scripts/statusline.js` (current lines 286-299)

**AC:**
- [ ] `buildRateView(result, cfExtras, nowMs)` returns existing v4.7.0 shape + new `freshness` and `source_id` fields
- [ ] `formatRateLimitLine(merged, termWidth)` 9-step degradation chain preserved byte-for-byte
- [ ] `(stale Xh Ym)` suffix appended when `freshness !== "FRESH"`, dim color
- [ ] When `freshness === "UNAVAILABLE"`, quota segments replaced with `hint_kind` literal (5 enum strings per FR-8)
- [ ] `expireResetLimits` deleted; no callers remain (`grep` returns 0)
- [ ] Cache-fix file extras (TTL/hit/PEAK/OVERAGE) merged when present, silently omitted when absent (FR-7)

**VE:**
- `node --test scripts/test/rate-view.test.js scripts/test/format/rate-limit-line.test.js` passes ≥10 cases (FRESH/STALE/UNAVAILABLE × with/without cache-fix extras + 5 hint kinds)
- Snapshot test `scripts/test/format/rate-limit-line.snapshot.test.js` against `fixtures/native-fresh-v470-baseline.txt` → byte-identical

---

### GATE-3: Byte-identity verification (US-4 P2)

**Blocks:** T6 onward

**AC:**
- [ ] Snapshot test passes: `native-fresh-v470-baseline.txt` byte-equal to T5 output for native fixture
- [ ] If diff exists, must be limited to whitespace/non-semantic ANSI codes; document in `evidence/byte-identity-diff.txt`

**VE:** snapshot test file present, CI passes.

---

## Phase 5 — Tests + mock contract extension (NFR-6)

### T7: Integration fixtures + runner `[P]`

**PARALLEL-WITH:** T8 — distinct files verified (final-phase tests + docs, no shared state)

**Maps to:** NFR-6, C5, all FRs (regression coverage)

**Sequential** — depends on T6 (orchestrator wiring).

**Touches:**
- create `test/integration/fixtures/native-fresh.json`
- create `test/integration/fixtures/native-expired.json`
- create `test/integration/fixtures/proxy-happy.json`
- create `test/integration/fixtures/proxy-5xx-all-models.json`
- create `test/integration/fixtures/no-config.json`
- create `test/integration/fixtures.test.js`
- create `test/README.md` (mock contract docs)
- modify `scripts/statusline.js` to recognize `_mock_probe_response`, `_mock_topology`, `_mock_now_ms` stdin fields

**AC:**
- [ ] All 5 fixtures cover their stated topology + freshness scenario
- [ ] Each fixture pipes through `node scripts/statusline.js`, snapshot-compares stdout
- [ ] Mock contract doc explains the 3 new mock fields with examples
- [ ] No new npm dev-dep (NFR-4)

**VE:** `npm test` runs full suite (unit + integration) → exit 0, 0 skipped suites, ≥40 total assertions across all tests.

---

## Phase 6 — Orchestrator wiring + ship-readiness

### T6: Wire orchestrator (`scripts/statusline.js` rewrite)

**Maps to:** FR-1 (entry-point preservation), FR-7 (cache-fix optional merge), all FRs

**Sequential** — depends on T1, T2, T3, T4, T5.

**Touches:**
- rewrite `scripts/statusline.js` to ≤400 LOC, orchestrator-only:
  1. Read stdin (existing)
  2. `detectTopology(process.env, fs)` → topology
  3. `new HeaderProbeQuotaSource({ topology, ... })` → fetch
  4. If null → `new NullSource({ topology }).fetch()`
  5. `readCacheFixExtras(input, nowMs)` (existing v4.7.0 helper preserved, fed into rate-view)
  6. `buildRateView(result, cfExtras, nowMs)` → merged
  7. `formatRateLimitLine(merged, termWidth)` → string
  8. Write 4 lines (Line 1/2/3 logic preserved unchanged from v4.7.0 except `fetchUserProfile` call)
- preserve `bin/cli.js` install path (entry-point name `scripts/statusline.js` unchanged)
- update `scripts/statusline.js` profile-fetch to use `topology.target` for `api/oauth/profile` URL (Open Q3)

**AC:**
- [ ] `scripts/statusline.js` LOC ≤ 400 (current: 1142)
- [ ] All Phase 1-5 tests still pass
- [ ] Manual run on user's CPA-mode machine: Line 4 fully populated
- [ ] Manual run on a hypothetical native machine (override `_mock_topology`): byte-identical to v4.7.0
- [ ] No regression in Lines 1, 2, 3 (preserved v4.7.0 behaviour)

**VE:** `npm test` passes; `wc -l scripts/statusline.js` reports ≤400; manual smoke captured in `evidence/phase-6-manual-smoke.txt`.

---

### T8: CHANGELOG + version bump + README touch + Engram store `[P]`

**PARALLEL-WITH:** T7 — distinct files verified

**Maps to:** ship-readiness, NFR-3 documentation, project memory

**Sequential** — depends on T6 (need final state to write CHANGELOG).

**Touches:**
- modify `CHANGELOG.md` (prepend v5.0.0 entry)
- modify `package.json` (version `5.0.0`)
- modify `README.md` (≤10 line note on topology auto-detection)
- modify `TECHNICAL_DEBT.md` (mark closed: design:0% suppression item if subsumed; otherwise keep)
- engram store: feature decisions per pattern with title `topology-aware-quota v5.0.0 — F-001`

**AC:**
- [ ] CHANGELOG entry covers: header-probe source, FR-9 invariants, C1-C5, Out-of-Scope items
- [ ] `package.json` version field = `"5.0.0"`
- [ ] README touch ≤10 lines, no emojis, technology-agnostic
- [ ] Engram store call returns success ID; store record cites this CR

**VE:** `git diff` for these files; engram store ID echoed in commit message.

---

### GATE-4: Pre-merge full validation

**Blocks:** merge to main / npm publish

**AC:**
- [ ] All tests pass (`npm test` exit 0)
- [ ] No new npm deps (`git diff package.json` shows only `version` field changed in deps section; `dependencies`/`devDependencies` byte-equal to pre-merge)
- [ ] No string-literal proxy names in core (`grep -RE 'cpa|cliproxyapi|cache-fix' scripts/lib` → 0)
- [ ] No token-shaped strings in cache fixture outputs (`grep -E 'Bearer\s+[A-Za-z0-9_-]{20,}|sk-[a-zA-Z0-9-]{20,}'` → 0)
- [ ] Snapshot byte-identity test passes (US-4 acceptance)
- [ ] FR-3 enforcement grep passes: `grep -RE '/v0/management|auth-files' scripts/lib` → 0

**VE:** CI green; gate report saved to `.agent/specs/topology-aware-quota/evidence/gate-4-prerelease.json`.

---

## Task Dependency Graph

```
                   ┌─────────────┐
                   │   GATE-1    │
                   └──┬─────┬──┬─┘
                ┌─────┘     │  └─────┐
                ▼           ▼        ▼
              [T1] [P]    [T2] [P]  [T3] [P]
              topology    parser    creds + tw
                │           │        │
                └─────┬─────┴────────┘
                      ▼
                    [T4]              ← Phase 2 + 3 (folded)
                  quota-source
                      │
                      ▼
                   GATE-2
                      │
                      ▼
                    [T5]              ← Phase 4
                  rate-view + format
                      │
                      ▼
                   GATE-3 (byte-identity)
                      │
                      ▼
                    [T6]              ← Phase 6 orchestrator
                      │
                ┌─────┴─────┐
                ▼           ▼
              [T7] [P]    [T8] [P]
              fixtures    CHANGELOG + version
                │           │
                └─────┬─────┘
                      ▼
                   GATE-4 (pre-release)
```

---

## Parallelism Audit

`PARALLEL-WITH: T1 T2 T3 — distinct files verified (Phase-1 setup, no shared state)`
`PARALLEL-WITH: T7 T8 — distinct files verified (final-phase tests + docs, no shared state)`

All other tasks are sequential per dependency graph above. No `[P]` markers without provenance — fail-closed inheritance per CR-002 honored.

---

## Auto-forward target

`Skill("nvmd-platform:nvmd-validate", "topology-aware-quota")`
