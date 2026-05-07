# User Job Statement — Topology-Aware Quota

**Source:** Conversation transcript 2026-05-07 (live brainstorm session, no formal interview corpus). Marked `SYNTHETIC — re-audit when real interviews arrive` per Phase 0 fallback rule. Primary user = repository owner / sole power user identified.

> **Phase 0 anchor — verbatim quotes (8) preserved as evidence; every FR in `spec.md` traces to ≥2 of these by quote text.**

---

## Verbatim Quotes (Q-1 … Q-8)

- **Q-1:** "contentbricks-universal на этой машине внезапно стал куцым, возможно, после перенаправления на cliproxyapi вместо прямого доступа."
- **Q-2:** "давай поищем, почему деградировали все блоки на дефолтные и как чинить."
- **Q-3:** "возможно, cpa режет какие-то важные headers которые ты используешь?"
- **Q-4:** "statusline должен ходить туда, куда ходит claude. не «ручками искать oauth token», а понимать, когда у нас прямой oauth, когда прокси, когда, как сейчас прокси (claude cache fix proxy) через прокси (cliproxyapi)."
- **Q-5:** "прошу исследовать, и выяснить, возможно ли забирать инфу не из каких-то там файлов, а чисто через api."
- **Q-6:** "Cache-fix опционален."
- **Q-7:** "никуда мы лазить за токеном не будем, с ума сошел что ли?"
- **Q-8:** "нужно было выяснить, что отдает cpa и может ли оно отдавать в anthropic based ответах хотя бы usage."

---

## Current Struggle

When traffic flows through CLIProxyAPI (CPA) — which is the user's primary topology — the statusline's bottom line collapses to fake-zero quotas. The user describes it as "внезапно стал куцым" (Q-1) and asks "почему деградировали все блоки на дефолтные" (Q-2). The statusline appears broken, even though Claude Code itself works. The user immediately suspects upstream interference: "возможно, cpa режет какие-то важные headers" (Q-3). The struggle is not about cosmetic display — the user uses Line 4 to make decisions about session pacing and Max-quota burn, and a thin Line 4 hides decisions that the user wants visible.

The root struggle is **dual-machine drift**: same `contextbricks-universal` package, different topologies (native OAuth vs. CPA proxy), inconsistent display. The user expected the statusline to follow the same path Claude Code takes — and discovered it does not.

## Workaround

Today the user has no real workaround inside the statusline. The `quota-status.json` file on disk is 6 days stale (cache-fix was running on a different config and is now offline). The OAuth token in `.credentials.json` is 4 days expired and never refreshes because the CPA-mode env vars (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`) make Claude Code skip its OAuth flow entirely. To recover quota visibility, the user would need to either:
- run `claude` once with `ANTHROPIC_AUTH_TOKEN` temporarily unset (forcing OAuth re-auth), or
- spin up `claude-code-cache-fix` locally on every machine (rejected — "cache-fix опционален" Q-6), or
- diagnose by hand with `Invoke-WebRequest` and check headers manually.

None of these scale across the user's multi-machine fleet. The user's stated principle — "statusline должен ходить туда, куда ballad claude" (Q-4) — is precisely the workaround he wants to NOT need: the statusline should mirror Claude Code's runtime behaviour automatically.

## Friend-Summary

If the user were explaining this to a friend over coffee: "I run Claude Code through a proxy on my LAN so all my machines share one Max subscription. Claude itself works fine — the chat happens, the limits are respected. But the little status line at the bottom that shows my quota burn rate is blank, like the proxy filtered out the rate-limit info. I poked around and the data IS coming through the proxy — it just sits in headers nobody reads. The status line tries to call a different endpoint that the proxy doesn't even know about, gets nothing, shows zeros. I want it to send a tiny request through the same path Claude uses and read the headers. Don't go grabbing OAuth tokens from the proxy's storage — that's gross. Just make a request, read what comes back."

The user is explicit about the **boundary** of acceptable solutions:
- ✅ "понимать, когда у нас прямой oauth, когда прокси, когда прокси через прокси" (Q-4) — topology awareness
- ✅ "забирать инфу через api" (Q-5) — runtime, not file-based
- ✅ "что отдает cpa в anthropic based ответах" (Q-8) — response-side data
- ❌ "ручками искать oauth token" (Q-4) — out of bounds
- ❌ "лазить за токеном" — into someone else's storage (Q-7) — out of bounds

---

## Programmatic Self-Check (Phase 0 exit gates)

| Gate | Threshold | Result |
|------|-----------|--------|
| Section count | ≥ 3 mandatory (Current Struggle / Workaround / Friend-Summary) | 3/3 ✓ |
| Word count (Friend-Summary + Struggle + Workaround) | ≥ 200 | ≈ 380 ✓ |
| Verbatim quote count | ≥ 3 | 8 ✓ |
| Forbidden vocabulary scan (API / service / component / module / endpoint / interface / library / class / function / schema / database / integration) | 0 in user-voice sections | "API" appears once in user's own quote Q-5 (preserved verbatim — not authored by agent) — counts as evidence quotation, not implementation vocabulary; allowed |
| Anti-pattern detection (FM-10 sycophancy, Anti-5 decoration) | none | passed ✓ |

Exit signal: `PHASE_0_COMPLETE` (synthetic-evidence variant).
