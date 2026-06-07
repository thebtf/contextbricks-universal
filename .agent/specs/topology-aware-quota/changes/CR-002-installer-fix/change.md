# CR-002 — Installer copies all script modules, not just statusline.js

**Feature slug:** `topology-aware-quota`
**Parent feature:** F-001
**State:** open
**Created:** 2026-06-08
**Type:** HOTFIX (post-release defect, blocks packaged install)

## Problem

`bin/cli.js install` in v5.0.0 copies only `scripts/statusline.js` to
`~/.claude/statusline.js`. Starting with the v5.0.0 architectural pivot
(CR-001), `statusline.js` is a 362-LOC orchestrator that requires 9 sibling
modules under `scripts/lib/` (`ansi`, `topology`, `quota-source`,
`quota-parser`, `creds`, `detect-term-width`, `rate-view`, `meter-extras`,
`format/{rate-limit-line, ttl-prefix, extras-tail}`).

The deployed copy at `~/.claude/statusline.js` crashes on first invocation
with `Error: Cannot find module './lib/ansi'`.

**Reproduction (verified on this box, 2026-06-08):**

```
> npm i -g contextbricks-universal@5.0.0
> echo '{"model":{"display_name":"Claude Opus 4.7"}, ...}' | node ~/.claude/statusline.js
Error: Cannot find module './lib/ansi'
```

The bug affects **every fresh packaged install** of v5.0.0. Native-OAuth
users, CPA users, cache-fix users — all of them hit it. The v4.7.0 single-
file installer happened to work because v4.7.0 statusline was a single
1142-LOC file with no `require('./lib/...')` calls.

## Root Cause

`bin/cli.js:74` calls `fs.copyFileSync(STATUSLINE_SCRIPT, INSTALL_PATH)`
without copying `scripts/lib/`. The require resolver in
`~/.claude/statusline.js` looks for `./lib/ansi` relative to the deployed
file — there is no `lib/` directory at that path. Crash.

## Fix

Replace single-file copy with recursive copy of `scripts/lib/` alongside
`statusline.js`, preserving directory structure:

```
~/.claude/statusline.js               (from scripts/statusline.js)
~/.claude/lib/ansi.js                 (from scripts/lib/ansi.js)
~/.claude/lib/creds.js                ...
~/.claude/lib/detect-term-width.js
~/.claude/lib/meter-extras.js
~/.claude/lib/quota-parser.js
~/.claude/lib/quota-source.js
~/.claude/lib/rate-view.js
~/.claude/lib/topology.js
~/.claude/lib/format/extras-tail.js
~/.claude/lib/format/rate-limit-line.js
~/.claude/lib/format/ttl-prefix.js
```

Implementation: use `fs.cpSync(SCRIPTS_LIB_SRC, INSTALL_LIB_DST, { recursive: true })`
(Node 16.7+ — well below our Node 22 floor). Backup logic for existing
`statusline.js` extends to existing `lib/` directory (rename to
`lib.backup-<ts>/` if present).

`uninstall` action MUST also remove `~/.claude/lib/` (mirror the
deployed surface).

## Acceptance Criteria

- [ ] AC-1: Fresh `npm i -g contextbricks-universal@5.0.1` deploys
  `~/.claude/statusline.js` AND `~/.claude/lib/` (11 files: 8 at top
  level — ansi, creds, detect-term-width, meter-extras, quota-parser,
  quota-source, rate-view, topology — plus 3 under `format/`:
  extras-tail, rate-limit-line, ttl-prefix).
- [ ] AC-2: `echo '<minimal-stdin>' | node ~/.claude/statusline.js` runs
  without `MODULE_NOT_FOUND`, prints rendered statusline.
- [ ] AC-3: `contextbricks uninstall` removes both `~/.claude/statusline.js`
  and `~/.claude/lib/` (no orphan modules left).
- [ ] AC-4: Re-install over existing v5.0.0 install preserves backup of
  the broken state: `statusline.js.backup-<ts>` AND `lib.backup-<ts>/`
  (so user can roll back).
- [ ] AC-5: settings.json `statusLine.command` continues to point at
  `~/.claude/statusline.js` (unchanged from v5.0.0 install behaviour).
- [ ] AC-6: No new npm dependencies (NFR-4 from spec.md).

## Out of Scope

- Changing the installation directory (still `~/.claude/`).
- Migrating to symlinks (cross-platform fragility on Windows).
- Refactoring `bin/cli.js` beyond what AC-1..AC-6 require.

## Review-Cycle Amendments (2026-06-08, post AI-review)

CodeRabbit and Gemini reviewed the initial CR-002 patch and surfaced four
non-blocking findings; all four were accepted under
`long-term-integrity-over-speed` (installer = public interface, partial-failure
path warrants structural rather than localised fix; no quick-patch override
named):

| # | Source | Finding | Fix in this CR |
|---|--------|---------|----------------|
| 1 | CodeRabbit | Non-atomic install: if `lib/` copy fails after `statusline.js` copy, recreates the v5.0.0 defect | Swap copy order — `lib/` first, then `statusline.js` |
| 2 | CodeRabbit | Missing try/catch on `fs.copyFileSync` and `fs.cpSync` produces raw stack traces | Wrap both copy ops with rollback-on-error + friendly message |
| 3 | Gemini | `fs.existsSync` in `backupDir` returns `false` on broken symlinks → backup skipped, `cpSync` then misbehaves | Replace with `fs.lstatSync({throwIfNoEntry:false})` via new `pathEntryExists()` helper |
| 4 | Gemini | Same broken-symlink risk in uninstall cleanup | Same helper applied at uninstall site |

New AC additions for these:
- [ ] AC-7: install order is `lib/` first, `statusline.js` second.
- [ ] AC-8: a forced `cpSync` failure restores the previous `lib/` from backup, leaves `statusline.js` unchanged, exits 1 with a friendly message.
- [ ] AC-9: `pathEntryExists()` is used at all 3 file-system probe sites that target install artefacts (backupDir, backupFile, uninstall).
- [ ] AC-10: a failed `rmSync` on `~/.claude/lib/` during uninstall emits a warning and continues to settings.json cleanup; `statusLine.command` is removed from settings.json regardless of lib-removal outcome.

## Round 3 amendments (Gemini round-2 review, CodeRabbit minors)

| # | Source | Finding | Fix |
|---|--------|---------|-----|
| 5 | Gemini HIGH | `fs.rmSync(lib/)` crash aborts uninstall before settings.json cleanup → broken Claude Code state | try/catch around rmSync with warning + continue to settings.json (AC-10) |
| 6 | CodeRabbit minor | rollback asymmetry (Step 1 rename removes backup, Step 2 copy leaves backup) — needs comment | Asymmetry-note comment added in cli.js Step 2 rollback path |
| 7 | CodeRabbit minor | PR body / AC-1 said "12 files" but lib has 11 | AC-1 corrected to explicit "8 top-level + 3 in format/" enumeration |

## Round 4 amendments (Gemini round-3 review, CodeRabbit round-3)

| # | Source | Finding | Fix |
|---|--------|---------|-----|
| 8 | CodeRabbit MAJOR | `renameSync(libBackup → INSTALL_LIB_DIR)` fails if `cpSync` left a partial `INSTALL_LIB_DIR`; rollback error silently swallowed | Rollback now `rmSync` of any partial INSTALL_LIB_DIR before `renameSync`; rollback errors surfaced with preserved backup path |
| 9 | Gemini medium | `backupDir(INSTALL_LIB_DIR)` called outside try/catch — backup failure produces raw stack trace | Move `backupDir` call inside the try block of Step 1 |
| 10 | Gemini medium | `backupFile(INSTALL_PATH)` called outside try/catch — same risk for script | Move `backupFile` call inside the try block of Step 2 |
| 11 | Gemini medium | `unlinkSync(INSTALL_PATH)` in uninstall not wrapped — Windows EBUSY aborts before settings.json cleanup | try/catch with warning + continue, mirrors the AC-10 rmSync pattern |
| 12 | CodeRabbit minor | Evidence section said `engines is >=18` while package.json says `>=16.7` | change.md Evidence corrected to `>=16.7` |
| 13 | CodeRabbit minor | Stray `</content></invoke>` trailing tags in change.md (Write-tool input artefact) | Removed |
| 14 | CodeRabbit minor | README says `Node.js >= 14` while engines is `>=16.7` | README updated to `>= 16.7` with installer reason |

Deferred (TECHNICAL_DEBT):
- CodeRabbit cosmetic: `pathEntryExists(SETTINGS_FILE)` for symmetry — settings.json is never a symlink in practice; no behaviour delta.
- CodeRabbit carried: one-line `// rename, not copy` comment on `backupDir()` — CHANGELOG and Step 1+2 catch blocks already explain the asymmetry; redundant.

## Tasks

- **T1:** Patch `bin/cli.js` install action — add `fs.cpSync` of
  `scripts/lib/` to `~/.claude/lib/`, with backup-rename of existing
  `~/.claude/lib/` directory.
- **T2:** Patch `bin/cli.js` uninstall action — remove `~/.claude/lib/`
  if present.
- **T3:** Manual smoke — `npm pack` locally, `npm i -g ./tarball`,
  pipe stdin, verify no MODULE_NOT_FOUND.
- **T4:** Bump version 5.0.0 → 5.0.1, update CHANGELOG, commit, tag,
  push → triggers OIDC publish workflow.
- **T5:** Re-deploy on this box: `npm i -g contextbricks-universal@5.0.1`,
  verify Line 4 actually renders.

## Evidence

- v5.0.0 statusline header requires `./lib/ansi`, `./lib/topology`,
  `./lib/quota-source`, `./lib/creds`, `./lib/detect-term-width`,
  `./lib/rate-view`, `./lib/format/rate-limit-line`, `./lib/meter-extras`
  (verified via Read of `scripts/statusline.js:33-40`).
- `bin/cli.js:74` copies only `STATUSLINE_SCRIPT` to `INSTALL_PATH`
  (verified via Read).
- Live repro on this box: `npm i -g contextbricks-universal@5.0.0` →
  postinstall ran → smoke pipe → `Error: Cannot find module './lib/ansi'`
  (verified 2026-06-08).
- Node 16.7+ has `fs.cpSync({recursive:true})` (engines field in
  package.json is `>=16.7` — matches the minimum required floor).