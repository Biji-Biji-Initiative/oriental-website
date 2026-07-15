## Security review

The implementation is directionally correct, but the supplied evidence does **not** support production promotion yet. There is one unconditional release blocker and one unresolved trust-boundary issue that should be closed before the required staging proof.

### Ship blocker 1: the mandatory exact-SHA staging regression has not happened

The release contract requires the exact full merge SHA to be deployed to canonical staging and the spoof probe repeated before production promotion (`.apr/specs/oriental-abuse-control-hardening.md`, lines 39–46).

The evidence explicitly says that the exact-SHA staging proof, PR CI, merge, and production promotion remain outstanding (`.apr/evidence/abuse-control-hardening.md`, lines 73–74). The only live probe described was performed **before** the change, so it proves the original vulnerability and the intended trust assumption, not that the fixed revision behaves correctly in its deployed form.

This is a real release blocker rather than optional hardening. Local tests and a local production build cannot substitute for the contractually required deployed regression.

### Ship blocker 2: `X-Real-IP` fallback provenance is asserted, not demonstrated

The primary path is sound under the stated topology:

```ts
const proxyAddress = forwarded?.at(-1);
if (proxyAddress && isIP(proxyAddress)) return proxyAddress;
```

Using the rightmost validated `X-Forwarded-For` entry is appropriate when the immediate Traefik hop appends or supplies the direct client address. Ignoring `CF-Connecting-IP` fixes the demonstrated bypass.

The concern is the fallback:

```ts
const realIp = request.headers.get("x-real-ip")?.trim();
if (realIp && isIP(realIp)) return realIp;
```

`isIP` establishes only that the value looks like an IP address. It does not establish that Traefik, rather than the client, supplied it. The live evidence tests spoofed `CF-Connecting-IP` and spoofed `X-Forwarded-For`, but never establishes the provenance of `X-Real-IP`.

That distinction matters because Traefik’s sanitization is configuration-dependent: its current implementation removes pre-existing managed forwarding headers only when insecure forwarding is disabled and the immediate source is not trusted; otherwise an existing `X-Real-Ip` can be retained. ([GitHub][1]) If the usable `X-Forwarded-For` value can be absent or stripped while client-controlled `X-Real-IP` remains, an attacker can select arbitrary valid identities and rotate rate-limit buckets.

There is also a relevant Traefik advisory: affected versions allowed unauthenticated clients to remove managed forwarding headers with lowercase `Connection` tokens. The patched versions are Traefik v2.11.38 and v3.6.9. The advisory does not by itself prove this application is exploitable, but it means the exact proxy version and configuration are material parts of this trust boundary, not assumptions that should remain undocumented. ([GitHub][2])

The narrowest release-scope resolution is one of:

1. Remove the `X-Real-IP` fallback and return the stable shared bucket whenever no valid rightmost `X-Forwarded-For` value exists. The contract says the fallback **may** be used, not that it is required.
2. Alternatively, add release evidence establishing all of the following for the exact staging and production proxy configuration:

   * `forwardedHeaders.insecure` is disabled.
   * No public-client range is included in `forwardedHeaders.trustedIPs`.
   * The application container has no public path bypassing Traefik.
   * Traefik is on a patched version.
   * Client-supplied `X-Real-IP` cannot become the application identity when `X-Forwarded-For` is unusable.

Until one of those is done, the fallback repeats the same class of mistake as the original Cloudflare-header bug: trusting header provenance based on an infrastructure assertion that the acceptance evidence does not actually test.

## Other reviewed areas

**Malformed headers:** No crash or obvious fail-open behavior is present. An invalid final non-empty `X-Forwarded-For` token goes to the fallback and ultimately to `"0.0.0.0"` if that fallback is also invalid. Empty elements are discarded, and malformed earlier elements are ignored when the trusted rightmost element is valid. That is defensible for an append-at-the-right proxy model, though the contract should explicitly say that only the trusted rightmost element must be valid rather than describing the entire chain as “malformed.”

**Retry-After math:** For a finite epoch-millisecond `resetAt`, the math is correct:

```ts
Math.max(1, Math.ceil((resetAt - now) / 1000))
```

It cannot produce zero for an expired or sub-second reset, and `Math.ceil(resetAt / 1000)` is a suitable absolute Unix-seconds reset value. No blocker is visible here. Optional hardening would reject non-finite values and derive both headers from an effective reset clamped to at least `now + 1000`; otherwise corrupted internal state could produce `"NaN"`, `"Infinity"`, or a past absolute reset timestamp.

**No-store preservation:** The evidence states that the public routes attach the new headers to their application-generated 429 responses while continuing to use the existing no-store response helper. It also claims focused coverage of the voice-session response wrapper. Nothing supplied demonstrates a header-loss bug. The remaining exact-SHA CI and staging run must nevertheless prove this on the release artifact.

**Schema and telemetry drift:** The evidence covers the signed snapshot schema, admin state, evaluation classification, and UI behavior for `realtime_busy`, with strict TypeScript, focused tests, the full Vitest suite, and production build all reported as passing. No concrete enum or telemetry drift is visible from the supplied material.

**Visitor recovery copy:** Distinguishing an upstream Realtime 429 from `voice_limit_reached` is correct, and preserving the editable typed handoff is the important recovery property. Saying the live service is “busy” is not a ship blocker, though “temporarily unavailable” would be slightly more accurate because an upstream 429 can represent project-level capacity or rate-limit conditions rather than global service load.

**Future topology changes:** The rightmost-address rule is limited to the stated DNS-direct, one-trusted-Traefik-hop topology. Enabling Cloudflare proxying or adding another upstream proxy would require a new trusted-proxy-depth policy; otherwise the rightmost address could become an intermediary rather than the visitor. That is future hardening, not a blocker for the explicitly documented current topology.

VERDICT: DO NOT SHIP

[1]: https://github.com/traefik/traefik/blob/master/pkg/middlewares/forwardedheaders/forwarded_header.go "traefik/pkg/middlewares/forwardedheaders/forwarded_header.go at master · traefik/traefik · GitHub"
[2]: https://github.com/traefik/traefik/security/advisories/GHSA-92mv-8f8w-wq52 "Case-Sensitive Bypass in Connection Header Allows Removal of X-Forwarded Headers · Advisory · traefik/traefik · GitHub"
