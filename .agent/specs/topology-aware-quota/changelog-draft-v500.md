# CHANGELOG draft for v5.0.0 (T8 use)

This is a working draft. T8 will prepend the final form to `CHANGELOG.md`.

```markdown
## [5.0.0] — 2026-05-08 (planned)

### Changed (BREAKING for nobody — proxy-mode users gain quota visibility, native users see no diff)
- **Quota source replaced: response headers, not OAuth API.** Statusline now sends a single minimal `POST /v1/messages` (max_tokens: 1, "." prompt) through `$ANTHROPIC_BASE_URL` and parses `anthropic-ratelimit-unified-*` from the response. Previously called `/api/oauth/usage` directly with a hard-coded `api.anthropic.com` host, which silently broke under any proxy.
- **Native-first, proxy-agnostic.** No proxy-specific code paths. ENV-vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`) drive runtime resolution; statusline mirrors Claude Code's own resolution order. CLIProxyAPI / claude-code-cache-fix / native OAuth — all transparently supported.
- **Pass-through-unknown bucket parser.** New `anthropic-ratelimit-unified-*` buckets (e.g., future `7d_haiku`) preserved verbatim under `quotas[<name>]` instead of silently dropped. Forward-compatible without code change.
- **Honest staleness rendering.** `expireResetLimits()` removed — no more fake `0%` quota when a window resets but probe fails. Stale data renders with a dim `(stale Xh Ym)` suffix; total upstream failure renders a single dim hint message instead of zero-filled segments.
- **Module split.** `scripts/statusline.js` shrunk from ~1140 LOC to ~400 LOC. Logic lives in `scripts/lib/{topology,quota-source,quota-parser,creds,detect-term-width,rate-view,ansi}.js` + `scripts/lib/format/{rate-limit-line,ttl-prefix,extras-tail}.js`.

### Added
- **`CONTEXTBRICKS_QUOTA_PROBE_MODEL` env var.** Pin a model for the quota probe — required for proxies whose dispatcher rejects the default Haiku-tier names (e.g., CLIProxyAPI configured for OpenRouter-style provider mapping). Example: `CONTEXTBRICKS_QUOTA_PROBE_MODEL=claude-opus-4-6`. When the default chain works (native Anthropic), no env var needed.
- **FR-9 token confidentiality contract.** Bearer tokens never written to cache, hint messages, or stderr. Subprocess receives token via `env`, never argv.
- **Cache freshness state machine.** `~/.claude/.contextbricks-quota-cache.json` stores parsed quotas + meta only. FRESH < 180 s, STALE < 24 h, UNAVAILABLE ≥ 24 h. Atomic write via tmp+rename (POSIX) with Windows EBUSY retry-once + direct-write fallback.
- **Probe model fallback chain.** When env override absent: `claude-haiku-4-5 → claude-haiku-3-5 → claude-3-5-haiku-20241022`. First non-error model persisted to cache.
- **Anthropic-beta header chooser.** Tries `claude-code-20250219` first, falls back to no-beta on 4xx (non-model-not-found), persists working set.
- **Failure-mode taxonomy.** Five hint-kind enum values render as distinct Line 4 messages: `[no API auth — set ANTHROPIC_AUTH_TOKEN or run claude]`, `[auth token rejected — refresh credentials]`, `[API unreachable — service degraded]`, `[probe returned no ratelimit headers]`, `[no compatible probe model in upstream — set CONTEXTBRICKS_QUOTA_PROBE_MODEL]`.

### Removed
- **`expireResetLimits()`** — replaced by honest STALE freshness flag (FR-6).
- **Hard-coded `api.anthropic.com` host** in `https.request`. Now resolves via `$ANTHROPIC_BASE_URL` like Claude Code does.

### Migration
- v4.7.0 cache files (`~/.claude/.usage-cache.json`, `~/.claude/.profile-cache.json`) are left untouched. v5.0 writes its own `~/.claude/.contextbricks-quota-cache.json`. No postinstall delete; old files become orphans (≤ 2 KB each).
- ENV vars (`CONTEXTBRICKS_*`) and Claude Code env vars (`ANTHROPIC_BASE_URL`, etc.) all preserve v4.7.0 semantics. No breaking changes for native-OAuth users.
- **CPA / cache-fix / proxy-chain users:** if your statusline shows `[no compatible probe model in upstream]`, set `CONTEXTBRICKS_QUOTA_PROBE_MODEL=<model-name-your-proxy-recognizes>` (e.g., `claude-opus-4-6` if your CPA dispatcher maps Opus).

### Architecture references
- Spec, plan, tasks, validation report: `.agent/specs/topology-aware-quota/`
- Architectural rationale: `.agent/specs/topology-aware-quota/changes/CR-001-initial-scope/change.md`
- GATE-2 live-CPA evidence: `.agent/specs/topology-aware-quota/evidence/gate-2-probe-result.txt`
```

---

## README touch (≤10 lines for T8):

```markdown
### Topology auto-detection (v5.0+)

Statusline reads quota data from response headers of `$ANTHROPIC_BASE_URL/v1/messages` —
the same endpoint Claude Code itself uses. Works with native OAuth, CLIProxyAPI,
claude-code-cache-fix, or any combination.

**For proxy users:** if Line 4 shows `[no compatible probe model in upstream]`,
set `CONTEXTBRICKS_QUOTA_PROBE_MODEL` to a model your proxy dispatcher recognizes.
```

---

## Engram store payload (T8 final action):

```yaml
title: "topology-aware-quota v5.0.0 — F-001"
content: >
  Replaced direct /api/oauth/usage call with response-header probe via $ANTHROPIC_BASE_URL.
  Resolves CPA-mode quota visibility without proxy-specific code. Pass-through-unknown
  bucket parser, honest STALE UX, FR-9 token confidentiality, atomic cache writes.
  Empirical resolution: CPA dispatcher rejects haiku-tier names — added
  CONTEXTBRICKS_QUOTA_PROBE_MODEL env override. Net LOC: statusline.js shrunk 1140 → 400,
  logic split across 9 lib modules. Zero new npm deps. Backward-compatible for native users.
tags: [statusline, quota, oauth, anthropic, cpa, headers, architecture]
importance: 0.9
```
