# Integration Tests — stdin-mock contract

## Overview

`test/integration/fixtures.test.js` runs 5 end-to-end scenarios by piping fixture
JSON files into `node scripts/statusline.js` and asserting semantic presence in
stdout. No HTTP is made; all probes are intercepted by the mock contract (C5).

Run all integration tests:

```
node --test test/integration/fixtures.test.js
```

Run the full suite (unit + integration):

```
node --test scripts/test/topology.test.js scripts/test/quota-parser.test.js scripts/test/creds.test.js scripts/test/quota-source.test.js scripts/test/rate-view.test.js scripts/test/format/rate-limit-line.test.js test/integration/fixtures.test.js
```

## Mock fields (C5 stdin-mock contract)

These three fields can be injected into any JSON piped to stdin:

| Field | Type | Effect |
|-------|------|--------|
| `_mock_topology` | `object` | Overrides the env-var map seen by `detectTopology`. Keys: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`. Empty string = treat as unset. |
| `_mock_probe_response` | `object` | Replaces the HTTP probe subprocess with a fixed response `{ status, headers, body }`. No real network call is made. |
| `_mock_now_ms` | `number` | Pins the clock used for cache TTL state-machine computations. Drives FRESH/STALE/UNAVAILABLE transitions deterministically. |

Legacy mock fields from v4.7.0 continue to work alongside the new ones:
`_mock_rate_limits`, `_mock_profile`, `_mock_cache_fix`.

## Adding a new fixture

1. Create `test/integration/fixtures/<name>.json` with the required mock fields.
2. Set `_mock_now_ms` to a fixed epoch value (e.g. `1746619200000`).
3. Add a `test(...)` block in `fixtures.test.js` that calls `runFixture('<name>.json')`.
4. Assert semantic substrings (hint_kind literals or `bucket:N%` patterns) — not full
   byte-identical stdout (that breaks on terminal width and ANSI variation).

## Cache isolation

Each test run sets `CONTEXTBRICKS_CACHE_PATH` to a per-test temp file in `os.tmpdir()`.
The temp file is deleted after the test regardless of outcome. This prevents real user
cache from leaking into freshness assertions.

The `no-config` test additionally overrides `HOME`/`USERPROFILE` to a fresh temp
directory so `~/.claude/.credentials.json` is not found (required to get the
`no-auth` hint when the machine has real credentials present).
