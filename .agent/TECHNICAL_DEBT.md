# Technical Debt

## 2026-02-19: stripAnsi incomplete for non-CSI sequences

**What:** `stripAnsi()` regex `/\x1b\[[0-9;]*m/g` only strips CSI color codes. Does not
handle OSC sequences (`\x1b]0;title\x07`) or other non-CSI escape types.

**Why deferred:** Sufficient for current use — all colors emitted by statusline.js use
CSI format. Extending the regex adds complexity with no current benefit.

**Impact if not done:** `visibleLen()` may return incorrect length if OSC or other ANSI
sequences are ever added. Currently zero impact.

**Effort when ready:** Low risk — add one extra `.replace()` for OSC pattern.

**Context:** scripts/statusline.js:311-316, flagged in code review for v4.3.0

---

## 2026-02-19: Line 1 extreme narrow terminal — no truncation after full degradation

**What:** After dropping worktree/subdir/diff, if `line1Core` itself (model + repo:branch
+ git status) still exceeds `maxWidth`, the line will overflow. No hard truncation exists
for the core.

**Why deferred:** Rare edge case — core is typically 15-30 chars. Would require truncating
the only always-visible segment, harming readability. Real-world impact is near-zero.

**Impact if not done:** On extremely narrow terminals (< ~40 cols) with long git status
(many commits ahead/behind), Line 1 may still wrap.

**Effort when ready:** Low risk — add `stripAnsi(line1).substring(0, maxWidth)` after
final degradation step. May need ANSI re-application.

**Context:** scripts/statusline.js:478-481, flagged in code review for v4.3.0

---

## 2026-02-19: Line 3 and Line 4 have no overflow protection

**What:** Line 3 (bricks + stats + cost) and Line 4 (rate limit segments) are built
without checking `termWidth`. Can overflow on narrow terminals or when many rate limit
segments are shown.

**Why deferred:** Out of scope for v4.3.0 Line 1 fix. Known gap, lower real-world
frequency than Line 1 issue.

**Impact if not done:** On terminals narrower than ~60 cols, Lines 3-4 may wrap,
disrupting the 4-line layout.

**Effort when ready:** Medium risk — requires segment-aware truncation similar to Line 1
graceful degradation. Line 3 has bricks (variable width) + fixed stats segments.

**Context:** scripts/statusline.js (Line 3: ~470-560, Line 4: ~560+)
