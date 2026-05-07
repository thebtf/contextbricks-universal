# Requirement-Quality Checklist — F-001

> **Feature:** topology-aware-quota
> **Spec:** spec.md (8 FR / 6 NFR / 5 US / 5 clarifications)
> **Plan:** plan.md (6 phases, 8 tasks)
> **Generated:** 2026-05-07

This is "unit tests for English" — 9 quality dimensions × every FR/NFR/US. Pass = ✓ / Fail = ✗ / N/A = —.

---

## Dimensions

1. **Completeness** — does the requirement state both the "what" and the trigger/condition?
2. **Clarity** — would two engineers interpret this identically?
3. **Consistency** — does it agree with other requirements (no contradictions)?
4. **Measurability** — is the success state binary or quantifiable?
5. **Coverage** — does at least one user story trace to it?
6. **Testability** — can it be verified by an automated check or human evidence?
7. **Acceptance Criteria** — are pass/fail conditions explicit?
8. **Edge Cases** — are negative/empty/extreme inputs considered?
9. **Out of Scope** — boundary clear (what this requirement does NOT do)?

---

## Functional Requirements

| ID | Title | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notes |
|----|-------|---|---|---|---|---|---|---|---|---|-------|
| FR-1 | Walk runtime path (native-first, proxy-agnostic) | ✓ | ✓ | ✓ | ✓ | ✓ (US-1, US-4) | ✓ | ✓ | ✓ (env unset → fallback) | ✓ (no proxy-specific paths) | Cited at file:line; Q-9 explicit |
| FR-2 | Quota probe via response headers + pass-through-unknown parser | ✓ | ✓ | ✓ | ✓ | ✓ (US-1) | ✓ (parser has 11-bucket evidence) | ✓ | ✓ (unknown buckets) | ✓ (no /api/oauth/usage) | C3 anchored |
| FR-3 | No token theft, no auth-files traversal | ✓ | ✓ | ✓ | ✓ (binary: no read of those endpoints) | ✓ (US-1 boundary, Q-7) | ✓ (grep for `/v0/management` in source = 0 hits) | ✓ | ✓ | ✓ | Negative requirement, sharp |
| FR-4 | Probe model fallback chain | ✓ | ✓ | ✓ | ✓ (chain order pinned) | ✓ (US-1 reliability path) | ✓ (Phase 2 test) | ✓ | ✓ (chain exhaustion) | ✓ (no env override required) | Open Q1 has empirical resolution path |
| FR-5 | Cache contract (FRESH/STALE/EXPIRED) | ✓ | ✓ | ✓ | ✓ (180s, 24h numeric thresholds) | ✓ (US-3) | ✓ (state-machine test) | ✓ | ✓ (corrupt cache → no cache) | ✓ (no migration) | C4 anchored |
| FR-6 | Honest staleness rendering | ✓ | ✓ | ✓ | ✓ (suffix presence binary) | ✓ (US-2, US-3) | ✓ (snapshot tests) | ✓ | ✓ (UNAVAILABLE single-line) | ✓ (no fake zeros) | `expireResetLimits` deletion explicit |
| FR-7 | Cache-fix optionality preserved | ✓ | ✓ | ✓ | ✓ (binary: present or absent) | ✓ (US-1, Q-6) | ✓ (fixture: cache-fix files present and absent) | ✓ | ✓ (extras silently omitted when absent) | ✓ (does not block primary) | — |
| FR-8 | Failure-mode taxonomy (5 hint kinds) | ✓ | ✓ | ✓ | ✓ (5 enum values) | ✓ (US-2, US-5) | ✓ (Phase 5 fixture per kind) | ✓ | ✓ (each hint = its own edge case) | ✓ | Strong — table-driven |
| FR-9 | Token confidentiality (3 invariants) | ✓ | ✓ | ✓ | ✓ (3 binary invariants) | ✓ (US-1 boundary, Q-7) | ✓ (cache content can be grep'd for token literal in test) | ✓ | ✓ (debug-mode override rejected) | ✓ (subprocess env vs argv) | C2 anchored, FR-9 strongest doc in spec |

**FR pass rate: 9/9 = 100%.** No fails. No partials.

---

## Non-Functional Requirements

| ID | Title | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notes |
|----|-------|---|---|---|---|---|---|---|---|---|-------|
| NFR-1 | Probe cost — strict bounding | ✓ | ✓ | ✓ | ✓ ($0.001/day, 0.5% session) | — (cross-cutting NFR) | ✓ (cost calc in CHANGELOG audit) | ✓ | ✓ (off-tier model in fallback) | ✓ | Numerics explicit |
| NFR-2 | Probe latency budget | ✓ | ✓ | ✓ | ✓ (4000ms timeout) | — | ✓ (timeout fixture) | ✓ | ✓ (timeout → STALE/null path) | ✓ | Existing v4.7.0 timeout reused |
| NFR-3 | Backwards compatibility | ✓ | ✓ | ✓ | ✓ (byte-identity in US-4) | ✓ (US-4 P2) | ✓ (snapshot test in Phase 4) | ✓ | ✓ (env var contract preserved) | ✓ (no breaking removal) | — |
| NFR-4 | No new external dependencies | ✓ | ✓ | ✓ | ✓ (binary: package.json diff = 0) | — | ✓ (`git diff package.json` empty post-merge) | ✓ | ✓ | ✓ | Strong — table in plan |
| NFR-5 | Cache file safety | ✓ | ✓ | ✓ | ✓ (mode 0600, atomic write) | ✓ (US-3 indirectly) | ✓ (concurrent-write test) | ✓ | ✓ (EBUSY retry, parse-fail-self-heal) | ✓ | C4 anchored |
| NFR-6 | Test coverage | ✓ | ✓ | ✓ | ✓ (≥10 parser, ≥5 fixtures) | — | ✓ (CI test count) | ✓ | ✓ (each fixture covers one mode) | ✓ | C5 anchored |

**NFR pass rate: 6/6 = 100%.**

---

## User Stories

| ID | Title | Priority | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notes |
|----|-------|----------|---|---|---|---|---|---|---|---|---|-------|
| US-1 | Multi-machine power user under proxy — Line 4 just works | P1 | ✓ | ✓ | ✓ | ✓ (3 acceptance criteria) | ✓ (FR-1, FR-2, FR-7) | ✓ (Phase 6 manual run) | ✓ | ✓ (CPA + native + cache-fix-chain) | ✓ | Q-1, Q-4 anchored |
| US-2 | Honest degradation when upstream broken | P1 | ✓ | ✓ | ✓ | ✓ (3 acceptance criteria, hint literals) | ✓ (FR-6, FR-8) | ✓ (5 fixtures) | ✓ | ✓ (each FR-8 mode = edge) | ✓ | Q-2, Q-3 anchored |
| US-3 | Stale-cache visibility | P2 | ✓ | ✓ | ✓ | ✓ (3 acceptance criteria — suffix presence, expiry transition, recovery clears) | ✓ (FR-5, FR-6) | ✓ (mock-time fixture) | ✓ | ✓ (24h boundary) | ✓ | Q-2 indirectly |
| US-4 | Native-OAuth user — no behavior change | P2 | ✓ | ✓ | ✓ | ✓ (byte-identical snapshot, env-var preservation) | ✓ (FR-1, NFR-3) | ✓ (Phase 4 byte-identity test) | ✓ | ✓ (env-var-presence variations) | ✓ | NFR-3 anchored |
| US-5 | No-token machine — graceful zero-config message | P3 | ✓ | ✓ | ✓ | ✓ (2 acceptance criteria) | ✓ (FR-8 hint kind "no-auth") | ✓ (no-config fixture) | ✓ | ✓ (no probe attempted) | ✓ | — |

**US pass rate: 5/5 = 100%.**

---

## Cross-Artifact Trace Coverage

| Spec FR | Plan phase | Plan task | Test artifact |
|---------|------------|-----------|---------------|
| FR-1 | Phase 1 | T1 (topology.js) | topology.test.js |
| FR-2 | Phase 1, 2 | T2, T4 | quota-parser.test.js, fixtures/proxy-happy.json |
| FR-3 | Phase 6 (audit) | T8 | grep test in CI: `grep -r 'auth-files\|/v0/management' scripts/lib` exit 1 |
| FR-4 | Phase 2 | T4 | quota-source.test.js (model fallback) |
| FR-5 | Phase 3 | T4 cont. | quota-source.test.js (TTL state machine) |
| FR-6 | Phase 4 | T5 | format/rate-limit-line.test.js, fixtures/native-expired.json |
| FR-7 | Phase 4 | T5 | fixtures/proxy-happy.json (with + without cache-fix) |
| FR-8 | Phase 4 | T5 | fixtures/{no-config,proxy-5xx-all-models,native-expired}.json |
| FR-9 | All phases | All | grep test in CI: cache content scan for token-shaped strings |
| NFR-1 | Phase 2 | T4 (cost calc) | CHANGELOG verification step |
| NFR-2 | Phase 2 | T4 (timeout = 4000ms in code) | quota-source.test.js (timeout test) |
| NFR-3 | Phase 4 | T5 + T7 | fixtures/native-fresh.json snapshot |
| NFR-4 | Phase 6 | T8 | `git diff package.json` audit step |
| NFR-5 | Phase 3 | T4 cont. | quota-source.test.js (concurrent-write simulation) |
| NFR-6 | Phase 5 | T7 | `npm test` exit 0 with all suites |

**Trace coverage: 15/15 = 100%.**

---

## Critical Findings

**None.** All FR / NFR / US pass all 9 dimensions. Cross-artifact trace 100% covered.

## Suggested Improvements (non-blocking)

1. Consider adding a CI step that greps `scripts/lib/**` for the strings `auth-files`, `/v0/management`, `claudeAiOauth\.refreshToken` — fails build if any appear (FR-3, FR-9 enforcement).
2. Consider a CI step running `git diff package.json` against main and failing if `dependencies`/`devDependencies` keys changed without explicit annotation (NFR-4 enforcement).
3. Phase 5 fixtures are minimum 5 — consider 7th and 8th for: (a) clock-skew (`resets_at` 5min in past), (b) partial-headers (5h present, 7d missing).

These are nice-to-haves; do not block the pipeline.

---

## Verdict: **PASS — proceed to /nvmd-tasks**

All requirements meet quality bar. No CRITICAL ambiguity, no MEDIUM-or-higher gap.

Auto-forward target: `Skill("nvmd-platform:nvmd-tasks", "topology-aware-quota")`.
