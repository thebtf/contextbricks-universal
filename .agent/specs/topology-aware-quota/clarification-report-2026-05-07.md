# Clarification Report — F-001 (topology-aware-quota)

**Date:** 2026-05-07
**Feature:** Topology-Aware Quota Source — Statusline Walks Where Claude Walks
**F-ID:** F-001
**Active CR:** CR-001-initial-scope
**Spec:** `.agent/specs/topology-aware-quota/spec.md`
**Session questions asked / answered:** 5 / 5

---

## Coverage Summary

| Category | Status | Note |
|----------|--------|------|
| 1. Functional Scope | Clear | FR/NFR/Out-of-Scope/Success Criteria all present, measurable |
| 2. User Roles | Clear | Single primary persona (multi-machine power user); secondary native-OAuth user covered in US-4 |
| 3. Domain/Data Model | **Resolved (C3)** | Pass-through-unknown bucket parser; canonical-name table for known buckets |
| 4. Data Lifecycle | **Resolved (C1)** | v4.7.0 cache files left untouched; no migration logic |
| 5. Interaction & UX Flow | Clear | Failure states have explicit hints (FR-8) |
| 6. Performance/Scale | **Resolved (C4)** | Last-writer-wins, no lock, parse-fail-self-heal |
| 7. Reliability | Clear | 24 h stale-fallback + retry behaviour defined; covered in FR-5 |
| 8. Security | **Resolved (C2)** | FR-9 Token Confidentiality — three invariants on cache/hints/stderr |
| 9. Integration | Clear | Subsumed under C1 and FR-1 native-first contract |
| 10. Edge Cases | Clear | 10 explicit edge cases enumerated |
| 11. Constraints & Tradeoffs | Clear | 11 explicit Out-of-Scope items, rejected approaches recorded in change.md |
| 12. Terminology | Clear | FRESH / STALE / UNAVAILABLE / freshness — single vocabulary |
| 13. Completion Signals | **Resolved (C5)** | Extended stdin-mock pattern; ≥ 5 integration fixtures |
| 14. Miscellaneous | Clear | 3 `[NEEDS CLARIFICATION]` markers in Open Questions, all non-blocking — empirical resolution path documented in FR-4 |

---

## Resolutions

### C1 — Data Lifecycle: v4.7.0 cache file migration
**Q:** What to do with `~/.claude/.usage-cache.json` and `~/.claude/.profile-cache.json` on upgrade?
**A:** Ignore-and-leave. v5.0 writes only its own paths. No postinstall delete, no shape conversion. Documented as explicit Out-of-Scope.
**Rationale:** Migration code = unnecessary complexity for ≤ 2 KB orphan files. Shape incompatibility (OAuth-response vs. parsed-headers) plus 5 h Anthropic window means migration would save at most one render of value. Risk-vs-benefit favors leaving them alone.

### C2 — Security: Token redaction in error paths
**Q:** What is allowed to appear in cache content / hint messages / process stderr?
**A:** FR-9 Token Confidentiality enacted with three invariants:
- Cache stores parsed quotas + freshness + age + source_id + hint_kind enum + persisted probe_model only.
- Hint messages are FR-8 enum literals — no token interpolation.
- Stderr/stdout silent on probe failure.
- Token transport via `env: { ANTHROPIC_TOKEN }` to subprocess (preserves v4.7.0 pattern, never argv).
**Rationale:** Statusline carries long-lived bearer tokens (CPA api-key OR Anthropic OAuth). Leakage via screenshot, dotfile-git, or backup is the user's stated boundary (Q-7). Debug-mode override rejected — risk > value for per-render statusline.

### C3 — Domain/Data Model: Header schema evolution
**Q:** How does the parser handle Anthropic adding new bucket names?
**A:** Pass-through-unknown via regex `^anthropic-ratelimit-unified-(.+)-utilization$`. Known buckets project to canonical fields per table in FR-2. Unknown buckets stored under original name in `quotas[bucket_name]` map; not rendered by default.
**Rationale:** Empirical evidence in `quota-status.json` snapshot — 11 distinct buckets observed in real Anthropic data, 5 known to v4.7.0 parser. Whitelist would silently drop the 6 future-added buckets the same way it already drops `seven_day_oauth_apps`, `seven_day_cowork`, `tangelo`, etc. Pass-through is forward-compatible without code change.

### C4 — Performance/Reliability: Concurrent cache writes
**Q:** What happens when multiple Claude Code sessions trigger concurrent cache writes?
**A:** Last-writer-wins + parse-fail-self-heal:
- POSIX: tmp+rename (kernel-atomic).
- Windows: tmp+rename → on EBUSY, retry once after 50 ms → fallback to direct write.
- Reader on corrupt JSON: treat as no cache → fresh probe.
- No file lock, no `proper-lockfile`-style dependency.
**Rationale:** User runs multiple Claude Code sessions concurrently (`enableAllProjectMcpServers: true` + worktree tooling in `settings.json`). Probe idempotency (≈ identical headers in 3-minute window) makes write-write races harmless. NFR-4 (no new deps) holds.

### C5 — Completion Signals: Test strategy without live OAuth
**Q:** How are tests written without a live OAuth token in CI?
**A:** Extend v4.7.0 stdin-mock pattern with three new fields:
- `_mock_probe_response` — replaces HTTP probe with `{status, headers, body}`
- `_mock_topology` — overrides env-vars seen by topology resolver
- `_mock_now_ms` — pins clock for cache TTL state-machine
Integration tests pipe fixture JSON to `node scripts/statusline.js`, snapshot-compare stdout.
**Rationale:** v4.7.0 already has `_mock_rate_limits` / `_mock_profile` / `_mock_cache_fix` at lines 169, 304, 716 — extension is the natural pattern continuation. No `nock`/`msw`/`undici-mock` dev-dependency. NFR-4 holds.

---

## Outstanding Items

The 3 `[NEEDS CLARIFICATION]` markers in spec.md Open Questions remain — all are LOW-severity, non-blocking, with documented empirical resolution paths:

1. **CPA 502 on synthetic probe (claude-haiku-4-5).** Resolution: FR-4 fallback chain iterates probe models until one succeeds; the working model name persists. Implementation will resolve this empirically on first run against the user's `unleashed.lan:8321`. No spec gap.
2. **`anthropic-beta` header set choice.** Resolution: implementation tries `claude-code-20250219` first (matches Claude Code's actual request header set), falls back to no-beta on 4xx, persists working header set. Implementation detail.
3. **Profile endpoint under proxy.** Resolution: 24 h file-cache fallback already implemented in v4.7.0. Acceptable for v1 per NFR-3 backward-compat. Defer to follow-up CR if missing-@username gap surfaces.

These are not blockers for `/nvmd-plan` — they are empirical-resolution items appropriate for implementation phase.

---

## Spec status: **Ready for planning**

Auto-forward target: `/nvmd-plan topology-aware-quota`.

Verification methods used: M1 (structural parse — 5 categories transitioned Partial → Resolved in coverage map), M10 (this report file persisted at `.agent/specs/topology-aware-quota/clarification-report-2026-05-07.md`), M12 (user approval per question — all 5 answered with `recommended`).
