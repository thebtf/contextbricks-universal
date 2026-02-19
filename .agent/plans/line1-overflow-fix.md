# Plan: statusline Line 1 Overflow Fix

## Problem

Line 1 of statusline.js has no width constraint. Claude Code injects
right-aligned text on the same terminal row after the script outputs:
- `/ide for Visual Studio Code` — ~27 chars, when IDE integration active
- `Context left until auto-compact: X%...` — 60-90 chars, when context is low

Collision: Line 1 content + Claude's injection > termWidth → Line 1 wraps → full layout breaks.

Lines 2, 3 already constrained by termWidth. Line 1 is not.

## Plan (REVISE-approved by challenging-plans)

### Phase 1 — Utilities (statusline.js)
- 1.1 Add `stripAnsi(s)` — strips ANSI escape codes via regex
- 1.2 Add `visibleLen(s)` — returns `stripAnsi(s).length`

### Phase 2 — Right-padding config (statusline.js, lines 333-344)
- 2.1 Read `CONTEXTBRICKS_RIGHT_PADDING` env var (Number, default: 0)
- 2.2 Auto-detect VS Code: `process.env.TERM_PROGRAM === 'vscode'` → add 28 to rightPadding
  - 28 = length of " /ide for Visual Studio Code" (27 chars + 1 separator space)
- 2.3 Final: `const rightPadding = basePadding + (isVSCode ? 28 : 0)`

### Phase 3 — Line 1 graceful degradation (statusline.js, lines 405-442)
- 3.1 Build Line 1 base without diff stats (reusable intermediate variable)
- 3.2 Compute `diffSegment` separately: ` | +N/-N`
- 3.3 After full Line 1 assembly, check: `if visibleLen(line1) > termWidth - rightPadding`
- 3.4 Retry without diff stats
- 3.5 If still too long: retry without subdir
- 3.6 If still too long: retry without worktree name

### Phase 4 — Docs + version
- 4.1 Add `CONTEXTBRICKS_RIGHT_PADDING` to header comment (lines 10-16)
- 4.2 Bump package.json: `4.2.4 → 4.3.0`
- 4.3 Sync header comment: `4.2.0 → 4.3.0` (was stale)

## Critique Findings (addressed)

- `visibleLen` was missing as explicit task → added as 1.2
- Version in two locations diverged (package.json=4.2.4, header=4.2.0) → both bumped to 4.3.0
- Magic `28` needs comment → documented as ` /ide for Visual Studio Code` length

## Tech Debt (out of scope)

Line 3 and Line 4 have no overflow protection either. Recorded in TECHNICAL_DEBT.md.

## Files Modified

- `scripts/statusline.js` — Phases 1-3 + header + version
- `package.json` — version bump
