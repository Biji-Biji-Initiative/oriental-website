## Findings

**No merge-blocking defect remains in the supplied correction set.** The review packet contains the critical implementation excerpt and verification summary rather than a runnable branch checkout, so the test/build results below are reported evidence, not independently rerun results.

## Focused recheck

**Forwarded identity fails closed.** The runtime path shown in `.apr/evidence/abuse-control-hardening.md:22-37` reads only `X-Forwarded-For`. There is no `X-Real-IP` or `CF-Connecting-IP` fallback. Missing headers, an empty chain, or a non-IP rightmost hop resolve to the stable `"0.0.0.0"` bucket.

The proxy-chain selection is also correctly conservative: it selects the rightmost non-empty value—the address appended by the trusted Traefik hop in the documented one-proxy topology—and validates that value with `isIP`. Importantly, if that trusted rightmost value is malformed, the code does **not** scan leftward and accept an earlier client-controlled address; it fails closed instead. Earlier malformed or spoofed chain members cannot override a valid rightmost Traefik value.

**Rate-limit header math is correct.** The implementation uses:

```ts
Math.max(1, Math.ceil((resetAt - now) / 1000))
```

That produces an integer number of seconds, rounds partial seconds upward, and remains at least `1` at or just beyond the reset boundary. `Math.ceil(resetAt / 1000)` supplies the absolute epoch-seconds reset timestamp. The leads, newsletter, and voice-session routes are reported to attach both headers to every application-generated 429 (`.apr/evidence/abuse-control-hardening.md:40-49`).

**No-store behavior is preserved.** The additional rate-limit headers are passed through the existing response helpers rather than replacing their headers. The evidence specifically records preservation of `Cache-Control: no-store`, including through the voice-session response wrapper. This satisfies the contract’s requirement that adding 429 metadata must not make quota responses cacheable.

**Schema and telemetry propagation are complete.** `realtime_busy` is reported as accepted by the signed snapshot schema, persisted as the close reason, rendered as an amber operational condition in admin review, and retained in evaluation classification (`.apr/evidence/abuse-control-hardening.md:51-56`). That covers the request/schema, persistence, operational UI, and evaluation paths rather than changing only the visitor-facing message.

**Realtime 429 remains distinct and recoverable.** A 429 from the browser-to-OpenAI SDP exchange maps to `realtime_busy`; other unsuccessful SDP statuses remain `webrtc_failed`. The application’s own visitor quota continues to use `voice_limit_reached`. The busy path preserves the editable typed handoff and gives transient-capacity guidance, avoiding the incorrect claim that the visitor exhausted a daily allowance.

The reported verification is appropriately broad: focused security/API/schema/evaluation/UI tests, the complete Vitest suite, strict TypeScript, Biome, production build, public and fixture-backed Playwright, secret scanning, and `git diff --check` (`.apr/evidence/abuse-control-hardening.md:58-73`). PR CI must still be green before merging.

## Release-gate decision

The absence of exact-merge-SHA staging evidence is **not** a pre-merge code-review blocker because the full merge SHA does not exist until the PR is merged. The required sequence from `.apr/specs/oriental-abuse-control-hardening.md:42-47` is:

1. Complete review and PR CI.
2. Merge the branch.
3. Deploy the resulting full merge SHA to canonical staging.
4. Validate health and repeat the live spoof regression, proving changed client-supplied `CF-Connecting-IP` values still produce one stable hashed identity.
5. Promote that same SHA to production only after the staging proof succeeds, retaining the previous production SHA for rollback.

Thus, the branch may merge to create the exact SHA needed for staging validation. This approval does not waive PR CI or authorize production promotion before the exact-SHA staging gate passes.

VERDICT: MERGE
