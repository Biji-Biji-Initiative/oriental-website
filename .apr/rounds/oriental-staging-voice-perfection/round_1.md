I cannot approve this PR for staging merge.

**Blocker 1 — picker/variant authority is wider than canonical staging.**
`app/api/client-config/route.ts` enables the picker for any non-production hostname when `APP_ENV`/`SENTRY_ENVIRONMENT` is `staging`, not only `staging.oriental.mereka.io`. `app/api/voice/session/route.ts` likewise accepts submitted variants whenever `detectDeploymentEnvironment()` returns `"staging"`, and that function also falls back to env-based staging for non-canonical hosts. This violates the spec’s canonical-staging-only picker boundary.

**Blocker 2 — URL picker bypass still appears present.**
The docs now claim `/?voices=1` cannot bypass server authority, but the e2e tests still drive picker visibility through `/?voices=1` in `tests/e2e/home.spec.ts`. The patch shows server-side filtering, but no corresponding client removal of the existing query-param affordance. Even if production ignores the submitted variant at session mint, exposing the picker UI outside governed staging is still a picker bypass and evidence confound.

**Blocker 3 — eval stale-submission accounting is incomplete.**
`lib/eval/voice-eval.ts` only counts `staleEmailSubmissions` when there was also a rejected email capture. A stale routed/submitted old address after a correction can occur without a recorded rejection, so the required “stale submissions” signal can be undercounted.

**Blocker 4 — model/voice confound rejection is not complete.**
`validateVoiceExperimentEvidence()` only adds a confound dimension when `variant` is present. It does not reject rows where `voice` or `speed` changed with `variant: null`, and `scripts/eval-voice.ts` silently continues when read-only profile enrichment fails. That can produce unknown or incomplete attribution rather than fail closed.

The email reducer changes are materially stronger for high vs medium confidence, literal-email rejection, exact readback parsing, and clear-all tombstoning, but the governance and evidence boundaries above are release blockers. Production deployment is not authorized.

VERDICT: DO NOT MERGE
