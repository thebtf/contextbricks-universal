# Implementation Plan — Topology-Aware Quota Source

> **For:** F-001 — `topology-aware-quota` — open CRs: [CR-001-initial-scope]
> **Created:** 2026-05-07
> **Spec:** `.agent/specs/topology-aware-quota/spec.md`
> **Provenance:** Planned by claude-opus-4-7 on 2026-05-07. Inputs: spec.md (8 FR / 6 NFR / 5 US / 5 clarifications), user_job_statement.md (8 verbatim quotes), changes/CR-001-initial-scope/change.md (architectural rationale). Confidence: VERIFIED (NFR-4 no-new-deps preserved, source-verified `header_filter.go`); INFERRED (CPA 502 root cause).

---

## Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime | Node.js (existing) | Statusline already on Node; no new runtime |
| Language | CommonJS JavaScript (existing) | v4.7.0 uses CJS + `'use strict'`; preserve to keep diff minimal |
| HTTP | `https` via `spawnSync(node, ['-e', script])` (existing pattern) | NFR-4: no new deps. Preserves token-via-env subprocess isolation (FR-9 invariant). Native `fetch` migration is explicit Out-of-Scope. |
| File I/O | Node `fs` (sync) | Existing v4.7.0 pattern. Atomic write via tmp+rename per NFR-5. |
| Test runner | `node:test` (Node built-in) | Existing v4.7.0 dev workflow. No `jest`/`mocha`/`vitest` dep. |
| Snapshot | Hand-rolled `assert.strictEqual` on stdout text | NFR-4 — avoid `jest-snapshot`/`vitest/snapshot` deps. |

**Source verification:** read `package.json` next phase; confirm no transitive dep additions in `npm install` step. Library decisions table in §Library Decisions records "No external library candidate" for each component.

---

## Architecture

### Reversibility Decision Table (Phase 0)

Mandatory pre-design audit per `references/phase-0-reversibility-auditor.md`. All planned decisions classified.

| # | Decision | Class | Migration cost if reversed | Evidence anchor |
|---|----------|-------|---------------------------|-----------------|
| D1 | **Replace `/api/oauth/usage` direct call with `POST /v1/messages` header probe** | **PARTIALLY REVERSIBLE** | If Anthropic strips ratelimit headers from Messages API OR CPA adds them to its blocklist: refactor source resolver back to OAuth-API path + add token-refresh logic. Estimated cost: ≈2 days AI-assisted. Mitigation: cache-fix file source remains as Priority-2 fallback in resolver chain (FR-7). | spec.md US-1 (P1, multi-machine power user); user_job_statement.md Q-5/Q-8 |
| D2 | Module split into `scripts/lib/*` | REVERSIBLE | Inline back into `statusline.js` — find/replace at most. <1 hour. | NFR-3 backward compat preserved by keeping `statusline.js` entry-point unchanged |
| D3 | Cache file path `~/.claude/.contextbricks-quota-cache.json` | REVERSIBLE | Rename — parse-fail-self-heal (C4) makes the old name self-evict on next render. | C1 — orphan-tolerant by design |
| D4 | Remove `expireResetLimits()` zero-fake | REVERSIBLE | Re-add as ≈10-line function. Visible behavior change (FR-6) but locally reversible. | spec.md FR-6, US-2 acceptance criterion |
| D5 | Pass-through-unknown bucket parser (regex over header keys) | REVERSIBLE | Replace regex with whitelist `Set` lookup. <1 hour. | C3 — explicit forward-compat decision |
| D6 | Last-writer-wins concurrent-write contract (no lock) | REVERSIBLE | Add `proper-lockfile` if races prove harmful in practice. New dep; cost = ≈half day. | C4 — probe idempotency + NFR-4 |
| D7 | Probe model fallback chain (hardcoded list) | REVERSIBLE | Add env override or config file. <2 hours. | spec.md FR-4 + Open Q1 (empirical resolution path) |
| D8 | Stdin-mock contract extension (3 new fields) | REVERSIBLE | Remove fields. v4.7.0 mocks unchanged. <1 hour. | C5 — extension pattern |

**No IRREVERSIBLE decisions** in this plan. D1 is the only PARTIALLY REVERSIBLE item; mitigation path (cache-fix fallback) keeps full feature parity if header-source ever fails.

**`REVERSIBILITY_AUDIT: PASS`** — proceed to Phase 0 Outline.

### Phase Ordering Validation (per AP-REV-4)

User-story priorities from spec.md: US-1 (P1) — multi-machine CPA quota visibility; US-2 (P1) — honest degradation; US-3 (P2) — stale-cache visibility; US-4 (P2) — native-OAuth no-regression; US-5 (P3) — no-token hint.

| Phase | Stories addressed |
|-------|-------------------|
| Phase 1 (skeleton) | foundation for US-1, US-4 |
| Phase 2 (probe + parser) | US-1 (P1) lands here |
| Phase 3 (cache + freshness) | US-2 (P1), US-3 (P2) land here |
| Phase 4 (renderer integration) | US-4 (P2) byte-identity test passes here |
| Phase 5 (tests + mock contract) | NFR-6 satisfied |
| Phase 6 (profile + cleanup) | US-5 (P3) delivered |

P1 stories land by end of Phase 3 — early-and-mid plan. Tech-first ordering avoided.

---

### Component Map

```
scripts/
  statusline.js                  ← orchestrator only (~400 LOC, down from 930)
  lib/
    topology.js                  ← detectTopology()
    quota-source.js              ← HeaderProbeQuotaSource + NullSource
    quota-parser.js              ← parse anthropic-ratelimit-* headers → shape
    rate-view.js                 ← buildRateView(result)
    creds.js                     ← readOAuthToken, readCredentialsExpiresAt
    detect-term-width.js         ← detectTermWidth (extracted as-is)
    format/
      rate-limit-line.js         ← formatRateLimitLine + 9-step degradation chain
      ttl-prefix.js              ← buildTTLPrefix
      extras-tail.js             ← buildExtrasTail
test/
  topology.test.js
  quota-parser.test.js
  quota-source.test.js
  rate-view.test.js
  format/
    rate-limit-line.test.js
  integration/
    fixtures/
      native-fresh.json
      native-expired.json
      proxy-happy.json
      proxy-5xx-all-models.json
      no-config.json
    fixtures.test.js             ← stdin-pipe → snapshot stdout
```

### Data Model

```javascript
// scripts/lib/types.js (or just JSDoc — no new file needed)

/**
 * @typedef {Object} Topology
 * @property {string} target                 — resolved upstream URL (e.g., "https://api.anthropic.com" or "http://unleashed.lan:8321")
 * @property {string|null} authToken         — bearer value (env first, then creds.json)
 * @property {string|null} authSource        — "env:ANTHROPIC_AUTH_TOKEN" | "env:ANTHROPIC_API_KEY" | "creds.json" | null
 */

/**
 * @typedef {Object} QuotaResult
 * @property {QuotaData|null} data
 * @property {"FRESH"|"STALE"|"UNAVAILABLE"} freshness
 * @property {number} age_ms
 * @property {"hdr-probe"|"cache-stale"|"null"} source_id
 * @property {string} [hint_kind]            — one of FR-8 enum: "no-auth" | "auth-rejected" | "upstream-5xx" | "no-headers" | "no-model"
 */

/**
 * @typedef {Object} QuotaData
 * @property {QuotaBucket} [five_hour]
 * @property {QuotaBucket} [seven_day]
 * @property {QuotaBucket} [seven_day_sonnet]
 * @property {QuotaBucket} [seven_day_opus]
 * @property {QuotaBucket} [seven_day_omelette]
 * @property {Object} [extra_usage]          — utilization-only (no resets_at)
 * @property {Object<string, QuotaBucket>} [quotas]   — pass-through unknown buckets per C3
 */

/**
 * @typedef {Object} QuotaBucket
 * @property {number} utilization            — 0..1 ratio
 * @property {string} resets_at              — ISO 8601 or unix-seconds string
 * @property {string} [status]               — "allowed" | "allowed_warning" | "exceeded"
 */

/**
 * @typedef {Object} CacheRecord
 * @property {QuotaData} data
 * @property {number} timestamp_ms           — write time
 * @property {string} probe_model            — model name that succeeded
 * @property {string} schema_version         — "v5.0.0"
 */
```

No external schema lib (NFR-4). Validation is duck-typed: `quota-parser.js` returns the shape; downstream readers tolerate missing optional fields.

### API Contracts (internal)

```javascript
// scripts/lib/topology.js
function detectTopology(env, fsAccess) → Topology

// scripts/lib/quota-source.js
class HeaderProbeQuotaSource {
  constructor({ topology, cachePath, mockProbeFn, nowMs }) { ... }
  fetch() → QuotaResult
}
class NullSource {
  constructor({ topology }) { ... }
  fetch() → QuotaResult                       // always { data:null, freshness:"UNAVAILABLE", hint_kind: ... }
}

// scripts/lib/quota-parser.js
function parseRateLimitHeaders(headers) → QuotaData
//   captures /^anthropic-ratelimit-unified-(.+)-utilization$/i
//   maps known buckets to canonical names; passes unknown through under quotas[]

// scripts/lib/rate-view.js
function buildRateView(result, cfExtras, nowMs) → MergedView
//   same shape as v4.7.0 but adds `freshness` and `source_id` fields

// scripts/lib/format/rate-limit-line.js
function formatRateLimitLine(merged, termWidth) → string
//   9-step degradation chain preserved
//   adds `(stale Xh Ym)` suffix when freshness ≠ FRESH
//   replaces quota segments with hint_kind literal when freshness = UNAVAILABLE
```

### Key Algorithms

**`detectTopology(env, fsAccess)`:**
1. `target = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'` (strip trailing `/`)
2. `authToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || readCredsToken(fsAccess)`
3. `authSource` set per branch above
4. Return `{ target, authToken, authSource }` — no proxy-specific code paths (FR-1)

**`HeaderProbeQuotaSource.fetch()`:**
1. If cache-hit and age < 180s → return `{ data, freshness:"FRESH", age_ms, source_id:"hdr-probe" }`
2. Else: try probe with `cache.probe_model || PROBE_MODELS[0]`
3. On 200 OK: parse headers → write cache (atomic tmp+rename, fallback per C4) → return FRESH
4. On model-not-found 4xx: advance `PROBE_MODELS` chain, persist new model name
5. On other 4xx: classify hint_kind (`auth-rejected`/`no-headers`/etc.); if cache age < 24h → return STALE; else → null
6. On 5xx / network: same stale-fallback path (24h window)

**`parseRateLimitHeaders(headers)`:**
1. Lowercase-iterate header keys
2. For each key matching `/^anthropic-ratelimit-unified-(.+)-utilization$/i`:
   - bucket = capture group
   - look up canonical mapping table (`5h`, `7d`, `7d_sonnet`, `7d_opus`, `7d_omelette`, `overage`)
   - read `*-reset` and `*-status` siblings
   - parseFloat utilization, parseDate reset
3. Project known to canonical fields; preserve unknown under `quotas[bucket]`
4. Return `QuotaData`

---

## Phases

#### Concurrent Work Directives (computed)

Per Phase 0.5 Standard-path analysis: 8 high-level tasks across 4 subsystems (`lib/`, `lib/format/`, `test/`, `statusline.js` orchestrator). Pairwise file-distinctness verified — no two `[P]`-eligible tasks touch the same file.

| Task ID | Touches | Parallel-with |
|---------|---------|---------------|
| T1 | `scripts/lib/topology.js`, `test/topology.test.js` | T2, T3 |
| T2 | `scripts/lib/quota-parser.js`, `test/quota-parser.test.js` | T1, T3 |
| T3 | `scripts/lib/creds.js`, `scripts/lib/detect-term-width.js` (extract) | T1, T2 |
| T4 | `scripts/lib/quota-source.js`, `test/quota-source.test.js` | (depends on T1+T2+T3) — sequential |
| T5 | `scripts/lib/rate-view.js`, `scripts/lib/format/*.js`, `test/rate-view.test.js`, `test/format/*.test.js` | (depends on T2) — sequential after T2 |
| T6 | `scripts/statusline.js` (orchestrator wiring) | (depends on T1..T5) — sequential |
| T7 | `test/integration/fixtures/*.json`, `test/integration/fixtures.test.js` | T8 (after T6) |
| T8 | `CHANGELOG.md`, `package.json` (version bump), README touch | T7 |

`PARALLEL-WITH: T1 T2 T3 — distinct files verified (Phase-1 setup, no shared state)`
`PARALLEL-WITH: T7 T8 — distinct files verified (final-phase docs + tests, no shared state)`

T4, T5, T6 are sequential — each consumes outputs from the prior. No `[P]` marker.

---

### Phase 1 — Skeleton + topology detector + creds extraction (US-1 foundation, US-4 zero-regress baseline)

**Tasks:** T1 (topology), T2 (parser stub), T3 (creds + detect-term-width extraction)
**Parallelism:** all three `[P]` — verified distinct files.

**Deliverables:**
- `scripts/lib/topology.js` with `detectTopology(env, fs)` + 8 unit tests covering env-var combinations
- `scripts/lib/quota-parser.js` skeleton + tests for ≥10 header-shape variations (including pass-through-unknown per C3)
- `scripts/lib/creds.js` extracts `readOAuthToken` from current `statusline.js:128-161`
- `scripts/lib/detect-term-width.js` extracts current `detectTermWidth` 1:1

**Verification evidence:** `node --test scripts/test/topology.test.js scripts/test/quota-parser.test.js` exits 0 with ≥18 passing assertions.

#### Contingency Branches (Reversibility: REVERSIBLE — Light)
- **If extraction breaks v4.7.0 baseline:** revert via single git commit (no semantic change in T3).

---

### Phase 2 — Header-probe source (US-1 P1 lands)

**Tasks:** T4 (`quota-source.js` — `HeaderProbeQuotaSource` + `NullSource`)
**Parallelism:** sequential (depends on T1, T2, T3).

**Deliverables:**
- `HeaderProbeQuotaSource.fetch()` implementing the §Key Algorithms steps 1-6
- `NullSource.fetch()` returning hint_kind enum per FR-8
- Probe HTTP via existing `spawnSync(node, ['-e', script])` pattern, token via env (FR-9 invariant)
- Probe model fallback chain `['claude-haiku-4-5', 'claude-haiku-3-5', 'claude-3-5-haiku-20241022']`
- Anthropic-beta header strategy (per Open Q2): try `claude-code-20250219` first, fall back to no-beta on 4xx, persist working set in cache

**Verification evidence:** `node --test test/quota-source.test.js` — covers fresh-cache hit, stale-cache fallback, 200 OK with headers, 4xx auth-reject, 5xx upstream, model-not-found chain advance.

#### Contingency Branches (Reversibility: PARTIALLY REVERSIBLE — Medium, per D1)
- **If real CPA returns 502 on every fallback model in user testing:**
  - Branch A (preferred): expand fallback chain via env override `CONTEXTBRICKS_QUOTA_PROBE_MODEL`. <1h.
  - Branch B (full pivot): refactor source chain to put cache-fix-files at Priority-1 when probe consistently fails (preserves FR-7 contract). ≈4h.
  - Branch C (escalate): mark in CHANGELOG as "manual probe-model config required for non-Anthropic-native dispatchers". User-visible documentation change.
- **If Anthropic adds CPA-blocking headers (e.g., requires Anthropic-only IP):** D1 reversal — restore OAuth-API source path. ≈2 days. Cache-fix file source covers users in interim.

---

### Phase 3 — Cache state machine + freshness contract (US-2 P1, US-3 P2 land)

**Tasks:** T4 cache-write half (continuation)
**Parallelism:** sequential.

**Deliverables:**
- Atomic tmp+rename writer with EBUSY retry-once + direct-write fallback per C4
- Cache record schema with `schema_version: "v5.0.0"` field
- Parse-fail-self-heal on cache read (corrupt JSON → treat as no cache)
- Stale-window classification: <180s FRESH, <24h STALE, ≥24h drop

**Verification evidence:** `_mock_now_ms` test fixtures drive transitions FRESH → STALE → UNAVAILABLE deterministically.

#### Contingency Branches (Reversibility: REVERSIBLE — Light)
- **If atomic write proves racy on Windows with concurrent CC sessions:** add advisory lock via `proper-lockfile` dep (NFR-4 violation → requires explicit user approval before pulling).

---

### Phase 4 — Renderer integration + remove `expireResetLimits` (US-4 byte-identity check)

**Tasks:** T5 (rate-view + format)
**Parallelism:** sequential after T2.

**Deliverables:**
- `buildRateView(result, cfExtras, nowMs)` returns existing v4.7.0 shape + `freshness` + `source_id` fields
- `formatRateLimitLine(merged, termWidth)` extracted, augmented with `(stale Xh Ym)` suffix when freshness ≠ FRESH
- Hint_kind enum-to-literal map (5 strings per FR-8)
- `expireResetLimits()` deleted; Phase 4 commit message references C2 + FR-6

**Verification evidence:**
- Snapshot test: native-fresh fixture → byte-identical output to v4.7.0 reference snapshot (US-4 acceptance)
- Snapshot test: stale-fixture → suffix present
- Snapshot test: no-config fixture → hint_kind literal rendered, no quota segments

#### Contingency Branches (Reversibility: REVERSIBLE — Light)
- **If byte-identity diff appears in snapshot:** diff is small (whitespace, color codes) — fix forward; if large, freeze and reassess approach.

---

### Phase 5 — Tests + mock contract extension (NFR-6 satisfied)

**Tasks:** T7 (integration fixtures + runner)
**Parallelism:** `[P]` with T8.

**Deliverables:**
- 5 integration fixtures: `native-fresh.json`, `native-expired.json`, `proxy-happy.json`, `proxy-5xx-all-models.json`, `no-config.json`
- Each fixture sets `_mock_topology`, `_mock_probe_response`, `_mock_now_ms` per C5
- `fixtures.test.js` pipes each to `node scripts/statusline.js`, snapshot-compares stdout
- Document mock contract in `test/README.md`

**Verification evidence:** `npm test` runs all unit + integration → passes 100%, no skipped suites.

#### Contingency Branches (Reversibility: REVERSIBLE — Light)
- **If snapshot drift in CI but not local:** investigate ANSI color env (CI may have `NO_COLOR` set). Add explicit `NO_COLOR=1` to test runner.

---

### Phase 6 — Profile fetch + cleanup + ship-readiness (US-5 P3, version + CHANGELOG)

**Tasks:** T6 (orchestrator wiring), T8 (CHANGELOG + version)
**Parallelism:** T6 sequential, T8 `[P]` with T7.

**Deliverables:**
- `statusline.js` orchestrator-only, ≤400 LOC (down from 930)
- `fetchUserProfile` — applies same env-resolution as `detectTopology` (Open Q3 path); 24h file-cache fallback preserved per NFR-3
- `package.json` version → `5.0.0` (semver: behavior change but native-OAuth users see no diff per US-4 — still a major bump because the source-of-truth changed)
- `CHANGELOG.md` entry: header-probe architecture, FR-9 token confidentiality invariants, C1-C5 rationales, Out-of-Scope items
- `README.md` touch: brief note on topology auto-detection (≤10 lines)
- Engram store: feature decisions per pattern, F-001 reference

**Verification evidence:**
- All previous phase tests still pass
- Manual run on user's CPA-mode machine: Line 4 fully populated, no fake zeros, hint_kind absent (= probe succeeded)
- Manual run on a hypothetical native machine (override `_mock_topology`): byte-identical to v4.7.0

#### Contingency Branches (Reversibility: REVERSIBLE — Light)
- **If post-merge regression on dev machine:** revert via single commit (modular structure makes reverts surgical).

---

## Library Decisions

| Component | External library? | Decision | Rationale |
|-----------|------------------|----------|-----------|
| Topology detection | No candidate considered | Custom (≈80 LOC) | Reads only env-vars + filesystem; no parser library needed |
| Header parsing | No candidate considered | Custom regex (≈40 LOC) | One regex + lookup map; library would be overkill |
| HTTP probe | Node built-in `https` via subprocess (existing pattern) | Custom | NFR-4: no new deps. Existing v4.7.0 subprocess pattern preserves token-via-env (FR-9) |
| File I/O | Node built-in `fs` | Custom | NFR-4 |
| Atomic write | No `proper-lockfile`, no `write-file-atomic` | Custom tmp+rename + EBUSY retry | NFR-4. C4 last-writer-wins makes lock unnecessary |
| Tests | `node:test` (built-in) | Built-in | NFR-4. v4.7.0 already uses it |
| Snapshot | No `jest-snapshot` etc. | Hand-rolled `assert.strictEqual` on stdout | NFR-4 |

**No new npm dependencies.** `package.json` `dependencies` and `devDependencies` lists unchanged after merge.

---

## Reusability Awareness

`reusability-detection: skipped — opt-out [plan] (no .agent/reusability-awareness.config.yaml or candidates pre-evaluated as project-specific)`

Module evaluation:
- `topology.js` — coupled to Claude Code env-var contract (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `~/.claude/.credentials.json`). Project-specific. Not library-eligible.
- `quota-parser.js` — coupled to Anthropic header schema. Project-specific. Not library-eligible.
- `quota-source.js` — composes the two above. Coupling inherited. Not library-eligible.
- `rate-view.js`, `format/*` — coupled to ANSI color helpers + 4-line statusline contract. Project-specific.

None — all planned modules evaluated, no library-eligible candidates.

## Domain Modeling

DDD evaluated — not needed. Rationale: <3 project-owned entities (only data shapes are HTTP-header projections + cache record); 0 domain invariants beyond the freshness 3-state enum. Forward-link: N/A.

---

## Unknowns and Risks

Carried from spec.md Open Questions — all empirical-resolution items, none block phase work:

| ID | Risk | Mitigation | Resolution phase |
|----|------|-----------|------------------|
| Q1 | CPA returns 502 on `claude-haiku-4-5` synthetic probe | FR-4 fallback chain iterates; D1 contingency branches (Phase 2) cover all three escalation levels | Phase 2 testing on user's `unleashed.lan:8321` |
| Q2 | `anthropic-beta` header set choice | Try `claude-code-20250219` first, fall back to no-beta on 4xx, persist | Phase 2 (in `quota-source.js`) |
| Q3 | Profile endpoint under proxy may 404 | 24h file-cache fallback already in v4.7.0; no behavior change for v5.0 | Phase 6 (orchestrator wiring) |

New risks identified in plan:

| ID | Risk | Mitigation |
|----|------|-----------|
| R1 | Snapshot test color-code drift between dev and CI | Force `NO_COLOR=1` in test runner; or strip ANSI in snapshot comparator |
| R2 | Module split breaks `npm publish` if package.json `files` field excludes new paths | Phase 6 reviews `files` glob; add `scripts/lib/**` if missing |
| R3 | `bin/cli.js` install uses absolute path to old `statusline.js` — refactor must preserve entry-point name | Keep `scripts/statusline.js` as the entry point unchanged in name and location |

---

## Constitution Compliance

Project AGENTS.md / CLAUDE.md not loaded — no `constitution.md` in `.agent/specs/`. Default principles applied:

- **No new deps without justification:** Compliant (NFR-4, no new entries in package.json deps/devDeps).
- **Backward compatibility:** Compliant (NFR-3 — native-OAuth users see byte-identical output).
- **Security defaults:** Compliant (FR-9 — token transport, cache content, hint message invariants).
- **Quality bar (production-grade):** Compliant — full FR/NFR coverage, ≥5 integration fixtures, snapshot tests for byte-identity.

---

## Validation Checklist (per `references/plan-template.md`)

- [x] Every FR in spec maps to phase/task (FR-1 → T1; FR-2 → T2; FR-3 → reviewed in Phase 6 audit; FR-4 → T4 Phase 2; FR-5 → Phase 3; FR-6 → Phase 4; FR-7 → Phase 4; FR-8 → T2 + Phase 4; FR-9 → enforced across all phases)
- [x] Every NFR has concrete approach (NFR-1 cost — Phase 2 ≤10 input + 1 output tokens; NFR-2 latency — 4000ms timeout in T4; NFR-3 backward-compat — Phase 4 byte-identity test; NFR-4 no-new-deps — Library Decisions table; NFR-5 cache safety — Phase 3 atomic write; NFR-6 test coverage — Phase 5 fixtures)
- [x] Library decisions documented for all components (table above)
- [x] File structure consistent with v4.7.0 (extends `scripts/`, preserves entry-point `statusline.js`)
- [x] Phases have clear boundaries + deliverables + verification evidence
- [x] Constitution compliance checked (default principles)
- [x] Phase 0.5 parallelism analysis ran against `green` SocratiCode index (verified earlier this session: `48 chunks, status=green`)
- [x] Concurrent Work Directives computed and recorded
- [x] All decisions classified by reversibility — D1 has Medium contingency block, all others REVERSIBLE-Light
- [x] No `[P]` marker without provenance — all `[P]` markers cite "distinct files verified"
- [x] Phase 0 Reversibility Audit emitted PASS

---

## Plan status: Ready for `/nvmd-checklist`

Auto-forward target: `Skill("nvmd-platform:nvmd-checklist", "topology-aware-quota")`.
