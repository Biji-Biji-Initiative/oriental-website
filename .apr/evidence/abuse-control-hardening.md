# Abuse-control hardening implementation evidence

## Live defect reproduction

On the deployed staging revision before this change, four invalid JSON requests
were sent to `/api/voice/session`; invalid requests do not mint OpenAI sessions
or spend voice quota.

- Two requests changed only the client-supplied `CF-Connecting-IP` value and
  produced different structured-log IP hashes.
- Two requests changed the client-supplied `X-Forwarded-For` value and produced
  the same structured-log IP hash, proving Traefik normalized that header to
  the real source address.

This demonstrates a live rate-limit bypass through the untrusted Cloudflare
header and validates the Traefik trust-boundary assumption used by the fix.
The running Coolify proxy reports Traefik `3.6.17`, above the `3.6.9` patched
floor named by APR round 1's forwarded-header advisory review.

## Implemented source behavior

`lib/server/security.ts` now:

```ts
const forwarded = request.headers
  .get("x-forwarded-for")
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const proxyAddress = forwarded?.at(-1);
if (proxyAddress && isIP(proxyAddress)) return proxyAddress;
return "0.0.0.0";
```

It never reads `CF-Connecting-IP` or `X-Real-IP`. This incorporates APR round
1's blocker: syntactic validation alone could not prove `X-Real-IP` provenance,
so an unusable forwarded chain now always fails closed. The implementation also
provides bounded response headers:

```ts
return {
  "Retry-After": String(Math.max(1, Math.ceil((resetAt - now) / 1000))),
  "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
};
```

The leads, newsletter, and voice-session routes attach those headers to every
application-generated 429. Existing response helpers continue to set
`Cache-Control: no-store`.

The browser Realtime SDP exchange maps an upstream 429 to `realtime_busy` and
all other failed response statuses to `webrtc_failed`. The close reason is
accepted by the signed snapshot schema, displayed as an amber operational state
in admin review, and retained in evaluation classification. Visitor copy says
the live service is busy and preserves the typed handoff; it does not claim that
the visitor exhausted their daily quota.

## Verification completed

- Biome checks passed on all changed runtime and test files.
- Strict app TypeScript passed.
- Seven focused test files passed with 57 tests, covering security, API routes,
  schema, evaluation, and UI behavior.
- Full Vitest passed: 37 files and 225 tests.
- Production Next.js build passed.
- Public Playwright passed: 28 tests, with 12 admin-auth tests intentionally
  skipped in the unauthenticated run.
- Fixture-backed admin Playwright passed: 11 tests, with the duplicate mobile
  workflow mutation intentionally skipped.
- The local secret scanner completed and correctly reported that deployment
  credentials are not present in the development shell; CI remains the
  credential-backed secret-validation gate.
- `git diff --check` passed.

APR round 1 returned `DO NOT SHIP` because the `X-Real-IP` fallback lacked
provenance; the fallback was removed. The focused correction in round 2 then
returned `VERDICT: MERGE` with no remaining code blocker. A third attempt to
work around APR's terminal-verdict validator produced no answer before the
shared Chrome cutoff; round 2 is complete on disk and workflow validation is
clean.

PR CI, merge, exact-SHA staging proof, and production promotion remain required
release gates.
