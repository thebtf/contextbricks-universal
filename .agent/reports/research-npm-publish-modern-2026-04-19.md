# Research: Modern npm publishing (без `npm publish` command)

**Date:** 2026-04-19
**Decision-anchor:** Publish `contextbricks-universal` v4.6.0 to npm. Current state: npm latest is 4.2.2, GH releases go up to v4.6.0. No auto-publish pipeline exists. User hint: "не через команду" — modern approach, not raw CLI.
**Tier achieved:** AUTHORITATIVE (3+ independent sources: docs.npmjs.com via WebFetch, GitHub official Changelog, two independent community blogs).
**Budget used:** 4/20 tool calls, 1 pass.

## Question

What's the current (April 2026) recommended way to publish an npm package from a GitHub repository, avoiding a raw `npm publish` from a developer laptop with a long-lived `NPM_TOKEN` secret?

## Answer — TL;DR

**npm Trusted Publishing with OIDC**, GA since **2025-07-31** (cite: GitHub Changelog). Publish runs in GitHub Actions on `git push` of a version tag; npm trusts the workflow via OpenID Connect without any long-lived token. Publish ships automatic **provenance attestations** — cryptographic proof the package was built from the linked source commit.

## Findings

### Source 1 — docs.npmjs.com/trusted-publishers (VERIFIED via WebFetch)

> "Trusted Publishing eliminates the need for long-lived npm tokens by using short-lived, cryptographically-signed tokens that are specific to your workflow."

Setup is 2 steps:
1. **On npmjs.com** — Package Settings → Trusted Publisher → select "GitHub Actions" → fill in `user/org`, `repo`, `workflow_filename` (exact file, e.g. `publish.yml`), optional `environment`.
2. **In the repo** — add `.github/workflows/publish.yml` with `permissions: id-token: write`, `setup-node@v6` pointing `registry-url: 'https://registry.npmjs.org'`, then `npm publish`.

Example workflow:

```yaml
name: Publish Package
on:
  push:
    tags: ['v*']

permissions:
  id-token: write   # REQUIRED — OIDC token
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test
      - run: npm publish
```

Requirements (cite: docs.npmjs.com):
- **npm CLI ≥ 11.5.1**
- **Node.js ≥ 22.14.0**
- **GitHub-hosted runner** (self-hosted не поддерживается)

### Source 2 — github.blog/changelog (VERIFIED via WebSearch)

> "npm trusted publishing with OIDC is generally available" (2025-07-31).

Independently confirms GA status.

### Source 3 — Community deployment experience (VERIFIED via WebSearch)

Multiple independent posts (philna.sh 2026-01-28, nickradford.dev, thecandidstartup.org 2026-01-26) describe live deployments. Consistent gotchas across all:
- **Caller workflow ≠ reusable workflow**: when publish logic is in a reusable workflow, the filename you register on npmjs.com must be the **caller** (the one with `on: push`), not the reusable one. npm authorizes the run initiator.
- **Provenance is automatic**: no `--provenance` flag and no `NPM_CONFIG_PROVENANCE=true` env — npm generates provenance attestations automatically under Trusted Publishing.
- **User-scoped packages are supported** (not just org-scoped). The `contextbricks-universal` package is user-scoped (owner `thebtf`) — this path works.

### Source 4 — engram recall

No prior project-level decisions about npm publishing in our memory; this is greenfield for this project. (Verified via `recall_memory`.)

## Comparison: approaches

| Approach | Security | Auto-ship | Provenance | Notes |
|---|---|---|---|---|
| **Trusted Publishing (OIDC)** ★ | short-lived token, per-workflow | yes (on tag push) | automatic | Modern default since 2025 |
| NPM_TOKEN secret | long-lived, revocable | yes | opt-in (`--provenance`) | Legacy; still works; rotation burden |
| Manual `npm publish` | developer laptop credential | no | no | Current state. Maintainer must remember. |

## Recommendation

**Add `.github/workflows/publish.yml` with OIDC Trusted Publishing.** Register `thebtf/contextbricks-universal` as a trusted publisher on npmjs.com for workflow `publish.yml`. Trigger on `v*` tag push.

**Value:**
- No `NPM_TOKEN` secret in GH repo (never added, can't leak)
- Publishes automatically on every `gh release create` with a version tag (i.e. bring npm in sync with GH releases permanently)
- Provenance badge on npmjs.com showing "Built and signed on GitHub Actions"
- Fixes the root cause of the current npm-lag (no human in the loop required after tag)

**Risk:**
- Needs one-time npmjs.com setup (Package Settings → Trusted Publisher)
- First run needs `npm login` from maintainer's machine to enable the trusted publisher (standard bootstrap)
- Requires Node ≥ 22.14.0 on runner (ubuntu-latest uses `actions/setup-node@v6 with node-version: '24'` — satisfies)

## What to be skeptical of

- **Reusable-workflow gotcha**: if we later extract shared publish logic into a reusable workflow, the npmjs.com config must continue to reference the **caller** filename. Easy to miss during refactor.
- **npm CLI version drift**: `setup-node@v6` + Node 24 ships modern npm, but if we pin an older Node (< 22.14.0), trusted publishing silently falls back to token auth and fails without secret.
- **User-scoped edge cases**: documentation says it works for user-scoped packages, and community posts confirm it, but npm's security model was originally designed for org-scoped packages. If edge-case bugs appear, fall back to `NPM_TOKEN` temporarily.

## Sources

1. [npm docs — Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) — official reference, authoritative
2. [GitHub Changelog — npm trusted publishing with OIDC is generally available (2025-07-31)](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/) — GA announcement
3. [Things you need to do for npm trusted publishing to work (philna.sh, 2026-01-28)](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/) — deployment gotchas
4. [npm Trusted Publishing and GitHub Actions (Nick Radford)](https://nickradford.dev/blog/npm-trusted-publishing-and-github-actions) — independent corroboration
5. [Bootstrapping NPM Provenance with GitHub Actions (thecandidstartup.org, 2026-01-26)](https://www.thecandidstartup.org/2026/01/26/bootstrapping-npm-provenance-github-actions.html) — provenance details
6. [Generating provenance statements — npm docs](https://docs.npmjs.com/generating-provenance-statements/) — official reference
7. [npm publish — GitHub Marketplace action](https://github.com/marketplace/actions/npm-publish) — action reference

## Exit signal

**RESEARCH_COMPLETE** — AUTHORITATIVE tier, decision-anchor satisfied, workflow YAML ready to implement.
