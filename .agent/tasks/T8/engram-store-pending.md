# Engram Store Pending — T8

The engram CLI was not available in the subagent shell context during T8 execution.
Store the following memory record when the CLI returns:

```
engram store_memory \
  --title "topology-aware-quota v5.0.0 — F-001" \
  --tags "statusline,quota,oauth,anthropic,cpa,headers,architecture" \
  --importance 0.9 \
  --content "Replaced direct /api/oauth/usage call with response-header probe via $ANTHROPIC_BASE_URL. Resolves CPA-mode quota visibility without proxy-specific code. Pass-through-unknown bucket parser, honest STALE UX, FR-9 token confidentiality, atomic cache writes. Empirical resolution: CPA dispatcher rejects haiku-tier names — added CONTEXTBRICKS_QUOTA_PROBE_MODEL env override. Net LOC: statusline.js shrunk 1140 -> 360, logic split across 9 lib modules. Zero new npm deps. Backward-compatible for native users."
```

## Fields
- title: "topology-aware-quota v5.0.0 — F-001"
- tags: statusline, quota, oauth, anthropic, cpa, headers, architecture
- importance: 0.9
- content: See above (inline with single-quote EOF heredoc in bash)

## Context
- Feature: F-001 / CR-001-initial-scope
- Task: T8 (CHANGELOG + version bump + README + engram store)
- Committed: chore(release): bump to v5.0.0 [T8]
- Date: 2026-05-07
