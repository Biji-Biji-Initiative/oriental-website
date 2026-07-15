# Oriental abuse-control hardening contract

## Runtime boundary

Oriental is served through Traefik on a DNS-direct origin. Cloudflare does not
proxy the current production or staging A records. A browser can therefore set
`CF-Connecting-IP` itself, while Traefik owns and normalizes the forwarded
client-address headers delivered to the Next.js container.

## Required behavior

1. IP-based rate limits must not use `CF-Connecting-IP` at the current direct
   origin.
2. The application must use the rightmost syntactically valid
   `X-Forwarded-For` address supplied by its trusted Traefik hop.
3. `X-Real-IP` must not be used as an identity fallback because syntactic
   validation alone does not prove proxy provenance.
4. Missing or malformed proxy metadata must fail closed into one stable shared
   bucket, not accept arbitrary input and not crash.
5. Every application-generated HTTP 429 must include a positive integer
   `Retry-After` value and an absolute reset timestamp without weakening the
   existing no-store behavior.
6. An OpenAI browser Realtime-call 429 must remain distinct from the
   application's per-visitor voice quota. The handoff remains editable, the
   close reason is persistable, and the UI gives transient capacity guidance.
7. Raw client addresses and secrets must not be logged or returned.

## Acceptance evidence

- Unit tests cover proxy-chain selection, Cloudflare-header rejection,
  validated fallback, fail-closed behavior, and rate-limit header math.
- Route tests prove 429 headers survive the voice session response wrapper.
- UI tests prove OpenAI 429 maps to `realtime_busy`, while application quota
  maps to `voice_limit_reached`.
- Schema, admin display, eval classification, and documentation accept the new
  close reason.
- Lint, strict TypeScript, the full Vitest suite, secret scan, and production
  build must pass before merge.
- Staging must repeat the pre-change spoof probe and show one stable hashed
  identity despite different client-supplied `CF-Connecting-IP` values.

## Release contract

Merge only through a reviewed PR after CI. Deploy the exact full merge SHA to
canonical staging first, validate health and the live spoof regression, then
promote the same SHA to production. Retain the prior production SHA as the
immediate rollback target.
