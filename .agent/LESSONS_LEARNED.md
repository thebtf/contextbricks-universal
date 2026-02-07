# Lessons Learned — ContextBricks Universal

## API Discovery

### Anthropic OAuth Usage API requires beta header
- **Problem:** `GET /api/oauth/usage` returns 401 "OAuth authentication is currently not supported"
- **Root cause:** Missing `anthropic-beta: oauth-2025-04-20` header
- **Discovery:** Nia oracle research found community tools (claude-usage, claude-statusline) using this header
- **Fix:** Add `'anthropic-beta': 'oauth-2025-04-20'` to request headers
- **Lesson:** Undocumented APIs may require feature flags via beta headers

### API response structure differs from assumptions
- **Problem:** Plan assumed `seven_day` covers Sonnet. Real API has separate `seven_day_sonnet` field.
- **Fix:** Added `seven_day_sonnet` to display and cache validation
- **Lesson:** Always verify real API response before coding against assumed schema

## npm Publishing

### Windows bin path normalization
- **Problem:** npm publish on Windows warns "script name bin/cli.js was invalid and removed" for `./bin/cli.js`
- **Fix:** Remove `./` prefix: `"contextbricks": "bin/cli.js"`
- **Lesson:** npm bin paths should not start with `./` when publishing from Windows

### Package name conflicts
- **Problem:** `contextbricks` already taken on npm by original bash author (jezweb)
- **Fix:** Published as `contextbricks-universal` with both `contextbricks` and `contextbricks-universal` as bin aliases
- **Lesson:** Check `npm search` before assuming package name availability

## Security

### Token handling in subprocess
- **Pattern:** Pass OAuth token via env var (`ANTHROPIC_TOKEN`), not argv
- **Reason:** argv visible in process list, env vars are not
- **Additional:** Cache file with mode 0o600 for restricted access

### macOS keychain JSON parse
- **Problem:** Single try/catch around keychain read + JSON.parse would abort entire function on non-JSON keychain data
- **Fix:** Separate try/catch for JSON.parse, allowing fallthrough to file-based credentials

## UX

### Terminal symbol readability
- **Problem:** `↻` (recycling symbol) is unreadable in many terminal fonts — looks like a squiggle
- **Fix:** Replaced with `~` prefix for reset times
- **Lesson:** Test special Unicode characters across different terminals before using

### Color consistency
- Labels (5h, 7d, sonnet) should be uniform dim white color, only percentages use gradient
- Users expect visual consistency for label categories
