---
title: "Oriental Governed Release Runbook"
type: "release_spec_and_runbook"
status: "implemented"
owner: "Mereka Engineering"
last_updated: "2026-07-17"
---

# 12 — Governed Release Runbook

This is the evergreen path for shipping Oriental. It replaces branch-specific
release notes. The goal is one reviewed change set, one final runtime SHA, one
staging proof, and one health-gated production promotion.

## Scope and non-goals

This contract covers application, Convex, runtime configuration, staging,
production, public routing, and release evidence. It does not turn subjective
voice quality or insufficient experiment data into an automated pass. It does
not require an application redeploy for documentation or operator tooling that
cannot affect the runtime image.

## Release invariants

- Runtime code, its spec, operator docs, tests, and relevant `AGENTS.md` guidance
  MUST land in the same PR.
- A runtime release MUST use a full immutable Git SHA. Moving tags and bare
  branch names are not release evidence.
- Production MUST deploy through the Coolify application API. Direct host
  Compose is reserved for the host-managed staging application and emergency
  rollback explicitly authorized by an operator. The host helper rejects a
  production target unless the operator supplies both the live full SHA and
  `--allow-emergency-production`.
- At a production promotion boundary, the proven staging candidate and
  production MUST use the same source SHA. Shared staging may move afterward
  for another controlled experiment; its live SHA must never be inferred from
  production or a historical document. Image tags remain distinct for release
  ownership. While the brand-motion preview is under staging approval, the
  Mereka M nebula and non-blocking, once-per-tab Trace entrance require both
  the public build flag and exact staging/local hostname. A production build
  from the reviewed source retains the legacy orb and no Trace entrance.
  Admin/API and reduced-motion loads omit the entrance treatment everywhere.
- `staging.oriental.mereka.io` and `oriental.mereka.io` are canonical. The
  `*.deploy.mereka.io` names MUST remain redirects only.
- Cloudflare MUST remain authoritative DNS only; Coolify Traefik terminates TLS.
- Infisical is canonical configuration. Coolify's environment-variable store
  and staging's host-local `.env` are separate materialized copies and MUST be
  compared with Infisical before release.
- The staging deployer MUST stream the complete native staging Infisical export
  over the encrypted fleet connection and atomically converge the host `.env`.
  The production deployer MUST reconcile and read back every approved runtime
  key from the native production application scope before changing the frozen
  SHA, explicitly clear values retired from Infisical, and re-read the
  `running:healthy` expected-current Coolify SHA immediately before every first
  mutation boundary. Retirement requires a code-reviewed entry in
  `RETIRED_MANAGED_APPLICATION_ENVIRONMENT_KEYS`; missing injection never
  authorizes clearing a live value. Concrete Infisical values are written as
  Coolify literals. The bulk API must acknowledge every exact write and its
  multiline/runtime/build scope; values are compared when the token may read
  them, while locked values remain hidden and are verified in the running
  container after release. Add a retirement tombstone in the same reviewed PR that
  removes the native Infisical value and retain it as ownership history; a
  later reintroduced source value wins safely. `NEXT_PUBLIC_*` keys are also
  build-time values. The Coolify credential needs scoped `read`, `write`, and
  `deploy` access; `read:sensitive` is deliberately unnecessary and values are
  never written to process arguments or logs.
- Production voice MUST remain `baseline/control/low/adaptive`. A staging-only
  model trial MUST be explicit, hold runtime/reasoning/capture constant, and
  never imply production promotion.
- A failed health check MUST stop the rollout. Never disable or weaken the gate
  to finish a release.

### Staging-only hold

When the approved release contract explicitly says staging-only, that boundary
is stronger than the normal production-promotion phases below:

- deploy only the exact merged SHA to canonical staging;
- do not mutate production, shared Convex, DNS, or the production Infisical/Coolify application;
- do not run a retention drain, migration, or backfill;
- use synthetic no-submit verification because staging shares production data
  and notification planes;
- capture read-only before/after proof that the production SHA, runtime/model
  cell, picker state, and current live brand-motion surface did not change. Do
  not represent a reviewed-but-undeployed production fallback as live evidence.

Staging success does not authorize promotion. Production requires a new
explicit operator decision, a fresh exact-tree review, and a new release gate.

## Context-independent takeover

Start every new operator or agent session with:

```bash
pnpm --silent ops:status --json
```

When fresh Convex evidence is needed without creating a local transcript-bearing
artifact or writing judge results, run:

```bash
pnpm eval:voice -- --aggregate-only --limit 100
```

This mode performs only read-only Convex evaluation queries, excludes synthetic
smoke rows, disables the LLM judge and every Convex mutation, writes no report,
and emits a single aggregate/gate JSON document. It may use the existing
per-session query to enrich missing historical `variant`, `voice`, and `speed`
with bounded concurrency. It omits transcripts, contact data, session
identifiers, and identifier-bearing attention lists. `--persist` and `--out`
are rejected in this mode. PII-free tool-call telemetry is included as overall
and per-tool sample/outcome counts plus execution, response-to-call, and
response-to-result p50/p95 distributions.

A broad audit remains deliberately fail-closed when a historical candidate
submission cannot be verified from immutable v1 evidence. Do not weaken that
join or backfill evidence to make the command green. For an exact staging
release window, record a UTC cutoff before the deployment and run the bounded
schema-v2 cohort after the no-submit smoke:

```bash
pnpm eval:voice -- --aggregate-only --limit 200 \
  --cohort-start "$cohort_start" \
  --cohort-environment staging \
  --target-model-cell candidate
```

All three cohort options are required together. The evaluator proves that the
updated-at-ordered 200-row query contains the complete post-cutoff window and
that the created-at-ordered lead query either exhausts the corpus below its
500-row cap or reaches strictly before the cutoff.
An exact-limit result cannot prove complete reconnect history. A local browser
can retain a conversation id even when a prior snapshot failed to persist, so a
time horizon is not a durable completeness proof. Affected target conversations
fail release quality and are removed from promotion evidence. The evaluator
rejects a truncated or empty target
cohort, requires verified v1 evidence for every current submission, and reports
older missing/invalid evidence only as
bounded PII-free `historicalEvidenceDebt` that cannot make the release green or
be treated as attribution. Customer `releaseQuality`, the synthetic activation/
remote-audio `syntheticPipeline`, and confound-sensitive `promotionEvidence`
are separate. A picker audition can prove the staging pipeline while remaining
invalid model-promotion evidence. With no post-cutoff organic conversation,
`releaseQuality` and the compatibility `gate` remain non-green; report that as
`insufficient_data` rather than fabricating customer evidence.

The command fetches and computes local/main Git state, both public health SHAs,
the non-secret live voice cells, branches and PRs containing deployed SHAs,
open PRs/issues, manual gates with owners, the latest checked-in APR verdict,
and the latest local aggregate-only voice evidence. It never emits transcripts
or captured contact data. GitHub issues and PRs are the canonical work queue;
shared ChatGPT/ACFS conversations are intake only and MUST be converted into a
spec, issue, or PR before implementation continues.

If GitHub, a health endpoint, or a local eval report is unavailable, the command
returns partial state with warnings. Missing voice evidence fails closed as
`insufficient_data`; it is never inferred as a pass.

## Release classification

Classify the PR before merging:

| Class | Examples | Application deploy |
|---|---|---|
| Runtime | `app/`, runtime `components/`, `lib/server`, Convex, Dockerfile, public build flags, dependencies | Required |
| Runtime configuration | Coolify/Infisical values used by the app | Recreate/deploy required |
| Operations only | release scripts, PR template, non-runtime tests | Not required unless imported by runtime |
| Documentation only | prose or historical evidence with no build/runtime effect | Not required |

If classification is uncertain, treat it as runtime-impacting. Record the
classification in the PR rather than rebuilding an application merely because
`main` gained an operations-only commit.

## Phase 1 — One-PR closure

Before merge:

1. Read `AGENTS.md`, this runbook, `11-INFRASTRUCTURE.md`, and any feature spec.
2. Put code, tests, docs, configuration contract, and rollback notes in one PR.
3. Run adversarial APR review for cross-layer, security, privacy, voice, or
   deployment changes. Trivial docs-only changes do not need APR.
4. Require green GitHub CI. Do not deploy an intermediate branch or partially
   reviewed SHA to production.

## Phase 2 — Final-SHA freeze

After the runtime PR merges:

```bash
git switch main
git pull --ff-only
sha="$(git rev-parse HEAD)"
infisical run \
  --domain https://secrets.mereka.io \
  --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
  --env staging \
  --path /deploy/oriental-website \
  -- pnpm release:verify:voice-cell -- --model-cell candidate --picker-mode clean
infisical run \
  --domain https://secrets.mereka.io \
  --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
  --env prod \
  --path /deploy/oriental-website \
  -- pnpm release:verify:voice-cell -- --model-cell control --picker-mode clean
infisical run \
  --domain https://secrets.mereka.io \
  --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
  --env prod \
  --path /deploy/oriental-website \
  -- env NODE_ENV=production pnpm release:preflight -- --sha "$sha"
```

Managed-environment validation is the default. The clean staging candidate
requires `baseline/candidate/low/adaptive` with `gpt-realtime-2.1`; production
requires `baseline/control/low/adaptive` with `gpt-realtime-2`. Both clean
candidate and production control require the QA picker off. A separately
declared staging audition uses `--picker-mode audition`; it cannot be promotion
evidence.
`--allow-unmanaged` exists only
for testing the Git/static contract and MUST NOT be used as production release
evidence. The fast parity command runs against both native Infisical
environments before the full production-env preflight, preventing staging
source drift from being hidden by the deployer's host-side safe defaults.
The managed preflight deliberately runs Vitest through
`scripts/run-release-tests.ts`, which retains only process/tooling variables and
forces `NODE_ENV=test`. Live application secrets stay injected for
the production build and final SHA/cell checks. The preflight itself forces
`NODE_ENV=production` only for `check-secrets`, so production-only routing,
admin, observability, notification, and Turnstile requirements cannot be
silently skipped, while application secrets cannot
select production React or leak notification/routing configuration into test
fixtures.

Once preflight passes, the SHA is frozen. Any runtime code, Docker, config, spec,
or runbook correction invalidates the freeze and restarts at Phase 1. Do not
create a late docs-only PR that changes the declared runtime release boundary;
include release docs before the first deployment.

## Phase 3 — Deploy dependencies and staging

1. Deploy Convex first only when the reviewed release diff changes schema or
   functions and the release is authorized to mutate the shared data plane.
   A staging-only hold that explicitly forbids shared-Convex mutation skips this
   step and must prove the web path remains backward-compatible with the live
   data plane. Aggregate-only evaluation remains read-only and cannot perform a
   deploy. Do not add a lossy `clear_fields` → `clear_field` application
   fallback.

   A release containing the indexed orphan-session sweep must deploy the frozen
   Convex functions, complete the bounded non-destructive lifecycle migration,
   and prove the secondary sweep is available before any web deployment:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env prod \
     --path /deploy/oriental-website \
     -- pnpm convex:deploy
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env prod \
     --path /deploy/oriental-website \
     -- pnpm convex:backfill:voice-session-lifecycle
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env prod \
     --path /deploy/oriental-website \
     -- pnpm release:verify:orphan-sweep
   ```

   The migration only normalizes legacy voice rows and materializes
   `sessionState`; it does not invoke retention deletion or transcript
   redaction. Both staging and production deploy entrypoints rerun the read-only
   verifier before their first external mutation, so a missing function,
   incomplete migration, or unavailable query cannot be represented as zero
   dropped sessions and cannot be bypassed by runbook drift.
2. Build the distinct `staging-<sha>` image and recreate host-managed staging:

   ```bash
   current_staging_sha="$(curl -fsS https://staging.oriental.mereka.io/api/health | jq -r .version)"
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- scripts/deploy-coolify-host.sh --target staging \
       --expected-current-sha "$current_staging_sha" \
       --voice-model-cell candidate \
       --voice-picker-mode clean "$sha"
   ```

   The script rechecks that SHA while holding the host deployment lock. If
   staging moved, stop and coordinate with its current owner; never overwrite an
   unknown experiment. Before the build, it streams the complete native staging
   Infisical dotenv export to the host through stdin and atomically converges
   every managed key without exposing values or replacing Compose-owned keys.
   It then materializes the selected governed non-secret voice cell. Candidate
   is legal only for staging and resolves to
   `baseline/candidate/low/adaptive`; every production host path rejects it. The
   picker is explicitly off in clean mode. Native Linux and WSL's Windows
   Tailscale client are selected automatically. `--voice-picker-mode audition`
   is an approved staging-only listening surface; its variant-tagged sessions
   are not valid candidate-model promotion evidence. For a human voice audition,
   redeploy with that mode, verify with `--staging-picker-mode audition`, run the
   smoke with `VOICE_SMOKE_MODE=audition`, then return staging to `clean` before
   model comparison or promotion.

   Immediately before the staging deployment, freeze the evaluation boundary:

   ```bash
   cohort_start=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
   ```

3. Run the deterministic public verifier:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- pnpm release:verify -- --sha "$sha" --target staging \
       --staging-model-cell candidate --staging-picker-mode clean
   ```

4. Run both smokes inside the staging managed environment so the short-lived
   proof can be signed. The clean candidate smoke is the default promotion
   evidence:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- pnpm smoke:staging:voice
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- pnpm smoke:staging:intake
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- pnpm release:verify:orphan-sweep
   ```

   The final command is the staging secondary-observability smoke: it must
   return `ok: true` with migration complete. A query failure or timeout is
   unknown telemetry, never a zero count.

   For a separately approved staging picker audition, rerun the first command
   with `-- env VOICE_SMOKE_MODE=audition pnpm smoke:staging:voice`. Audition
   evidence validates the picker and selected voice, but is not a clean model
   comparison and cannot authorize production promotion.

   Neither script may submit a lead: the browser aborts any lead POST and the
   server rejects the signed synthetic capability at the lead boundary. Both
   scripts inject a short-lived HMAC proof at the browser network boundary. The
   server signs the resulting review as synthetic and applies the reserved
   non-routable marker to every persisted snapshot, including quota/WebRTC
   terminal failures. A failed smoke must wait until that terminal snapshot is
   both persisted and applied before the browser closes; an out-of-order
   acknowledgement is not durable evidence.
5. Run the exact post-cutoff aggregate-only cohort command above. Require a
   complete session window, complete lead window, complete target reconnect
   history, and `syntheticPipeline.status=pass`. Keep customer
   quality and promotion status honest: no organic post-cutoff conversation is
   `insufficient_data`, and picker/variant evidence is never a clean model
   comparison. Historical evidence debt remains visible but does not authorize
   a backfill or weaken current v1 attribution.
6. Inspect the running container—not only Infisical—for the expected revision,
   deployment environment, and voice cells.
7. For a production promotion or separately authorized data-maintenance window,
   drain the bounded legacy backfill and retention sweep before trusting the
   admin, evaluation, SLA, or count views. The first drain intentionally applies
   the published 30/90/730-day deletion windows and is not reversed by a web
   rollback. Inspect the aggregate-only counts on every batch and continue until
   the route explicitly returns `hasMore=false`; an arbitrary fixed number of
   successful calls is not completion evidence:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- bash -ceu '
       has_more=true
       for attempt in $(seq 1 500); do
         response=$(curl -fsS -X POST \
           https://staging.oriental.mereka.io/api/admin/retention \
           -H "Authorization: Bearer $OPS_AUTOMATION_TOKEN" \
           -H "Content-Type: application/json" \
           -d "{}")
         echo "$response" | jq -e ".ok == true and (.hasMore | type == \"boolean\")" >/dev/null
         echo "$response" | jq -c "{hasMore,deleted,redacted}"
         has_more=$(echo "$response" | jq -r .hasMore)
         [ "$has_more" = false ] && break
       done
       [ "$has_more" = false ]
     '
   ```

   The 500-call guard is a runaway safety limit, not an allowed residual
   backlog. If it is reached, stop and diagnose; do not promote with hidden
   legacy rows. Skip this entire step during a staging-only/no-backfill hold.
8. Prove authenticated, Convex-backed admin reads independently of `/api/health`
   and discard the response body so lead/session content does not enter the
   release log:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- bash -ceu '
       curl -fsS https://staging.oriental.mereka.io/api/admin/review \
         -H "Authorization: Bearer $ADMIN_REVIEW_TOKEN" \
         | jq -e ".ok == true" >/dev/null
     '
   ```

Do not submit a staging lead casually: staging still shares production Convex,
OpenAI, Redis, and notification accounts.

## Phase 4 — Production

Skip this phase completely when the active release contract is staging-only.
Read-only production non-change proof remains required; no deploy, environment
write, retention call, or other production mutation is allowed.

1. Confirm staging proof and capture the current production rollback SHA.
2. Inject the operator-only Coolify credential and run the exact-SHA deployer:

   ```bash
   current_production_sha="$(curl -fsS https://oriental.mereka.io/api/health | jq -r .version)"
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env prod \
     --path /deploy/oriental-website \
     -- infisical run \
       --domain https://secrets.mereka.io \
       --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
       --env prod \
       --path /platform/coolify \
       -- pnpm release:deploy:production -- \
         --sha "$sha" \
         --expected-current-sha "$current_production_sha"
   ```

   The deployer fails unless staging currently runs the candidate SHA,
   production still runs the expected rollback SHA, and the candidate is an
   ancestor of `origin/main`. It pins Coolify's `git_commit_sha`, reads it back,
   starts the application, and refuses success unless the deployment record and
   public production health both resolve to the full frozen SHA. Before changing
   the SHA, it creates or updates every approved runtime key supplied by the
   application scope, requires an exact bulk-write acknowledgement, and reads
   back scope parity. Locked values remain hidden from the least-privilege
   token; inspect the running container against Infisical after the release.
   Public browser
   keys are enabled at build time as well as runtime. After deployment it also
   requires Coolify `running:healthy`, an enabled health check, and loopback
   health ownership at `127.0.0.1`. A terminal deployment may briefly precede
   application-status/public-health convergence, so the deployer waits up to 90
   seconds before treating it as a candidate failure.
   Once the candidate pin is attempted, every later failure automatically
   cancels a known candidate deployment, re-pins the previous SHA, redeploys
   it, and proves both Coolify health ownership and the exact public SHA. Lost
   PATCH or deploy-trigger responses are treated as ambiguous mutations:
   rollback reads back the pin and safely converges the same previous SHA. If
   Coolify briefly resolves a stale commit after re-pinning, that rollback
   deployment is cancelled and retried up to three times. A
   successfully restored rollback still exits non-zero because the candidate
   release did not succeed.
3. Require terminal `finished`; do not infer success from a queued build.
4. Verify both environments together:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env prod \
     --path /deploy/oriental-website \
     -- pnpm release:verify -- --sha "$sha" --target both \
       --staging-model-cell candidate --staging-picker-mode clean
   ```

   For `staging` and `both`, the verifier defaults to the established candidate
   staging cell; `--staging-model-cell control` remains available for an
   intentional rollback cell. This browser-backed verifier requires Playwright Chromium (or
   `PLAYWRIGHT_CHROMIUM_PATH`). It proves the exact Search Console meta tag,
   observes no GA request before consent, observes the expected GA asset only
   after clicking **Allow analytics**, and proves an already-consented admin
   surface still emits no GA request.

5. Confirm the deployer's result reports Coolify `running:healthy`, its health-check host is
   `127.0.0.1`, and the production container exposes the intended runtime cells.
6. Repeat the bounded retention drain against
   `https://oriental.mereka.io/api/admin/retention` with the production
   `OPS_AUTOMATION_TOKEN` until `hasMore=false`, then prove
   `https://oriental.mereka.io/api/admin/review` with the production
   `ADMIN_REVIEW_TOKEN` exactly as in staging. This independently proves the
   production routes, credentials, and Convex reads.
7. Manually dispatch `.github/workflows/analytics-ops.yml` from merged `main`
   and require every job to pass. This is the release proof for the separately
   stored GitHub `OPS_AUTOMATION_TOKEN`; Infisical/Coolify parity cannot prove a
   GitHub Actions secret:

   ```bash
   gh workflow run analytics-ops.yml --ref main
   run_id=$(gh run list --workflow analytics-ops.yml --branch main \
     --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch "$run_id" --exit-status
   ```

8. For voice releases, rerun the dry evaluator and report `insufficient_data`
   honestly when its minimum evidence gate is not met.

## Failure handling

| Symptom | Required response |
|---|---|
| CI fails | Fix in the same PR; do not deploy. |
| Staging health fails | The host deployer restores the timestamped Compose/`.env` pair, recreates the previous image, and proves its public SHA before exiting non-zero. Diagnose the candidate; production remains unchanged. |
| Coolify candidate health fails | The API deployer re-pins, redeploys, and publicly proves the prior SHA before exiting non-zero. Inspect binding, probe host, logs, and runtime env. |
| Automatic rollback reports unknown state | Stop. Do not retry. Preserve the printed backup paths and reconcile control-plane, host files, container, and public health ownership manually. |
| Public SHA differs | Stop. Determine whether the wrong source or image was deployed. |
| Staging moved before deploy | Stop. Another workflow owns the shared environment; coordinate instead of overwriting it. |
| Coolify deployment record resolves another commit | Cancel the candidate; production remains on the prior healthy SHA. |
| Infisical differs from container | Reconcile Coolify/staging materialization, recreate once, then re-verify. |
| OpenAI returns capacity 429 | Preserve the handoff; one bounded app retry is allowed. Do not loop deployments. |
| Product gate is sparse | Keep the control configuration. Collect evidence; do not call it a release failure. |

Repeated deployment is not diagnosis. If the same step fails twice, inspect
the relevant boundary before trying again.

## Time budget

For an already-reviewed runtime change, the operational target is:

- Preflight and final-SHA freeze: 5 minutes.
- Staging build and deterministic proof: 10 minutes.
- Production build, health swap, and proof: 15 minutes.
- Total deployment path: 30 minutes, excluding an external provider incident.

At 45 minutes, stop adding fixes to the release train. Record the blocking
boundary, return to one PR, and restart from a new final SHA. Quality comes from
early convergence and fail-closed checks, not repeated manual verification.

## Rollback

- App: redeploy the previous exact production image/SHA through Coolify.
- Endpointing: restore `VOICE_RUNTIME_PROFILE=baseline`.
- Model: restore `VOICE_MODEL_CELL=control`.
- Reasoning: restore `VOICE_REASONING_CELL=low`.
- Email capture: restore `VOICE_EMAIL_CAPTURE_MODE=strict` to require exact
  readback and explicit confirmation without rolling back the web image.
- Staging: restore the timestamped Compose/`.env` backup or previous
  `staging-<sha>` image. The host helper performs this automatically for every
  failure after file mutation and refuses to call it restored until the old
  image is recreated and the canonical health endpoint reports `ok: true` with
  the exact previous SHA.
- Convex: use backward-compatible schema/function changes; never assume an app
  image rollback also rolls back Convex. Additive persisted fields remain
  optional until every supported old web image is retired. Keep compatibility
  fallbacks limited to confirmed unknown/extra-field validation errors and keep
  the corresponding mutation idempotent; never mask a generic or ambiguous
  persistence failure with a retry.

## Acceptance criteria mapping

- [x] Exact SHA, clean `main`, image-tag, health-binding, runbook, and mandatory
  managed-cell checks: `scripts/release-preflight.ts`.
- [x] Exact staging/current-production preconditions, full Infisical→host and
  Infisical→Coolify runtime convergence, public build-variable readback,
  immutable Coolify commit pin/readback, deployment-record commit, terminal
  status, Coolify loopback-health ownership, and post-deploy public health:
  `scripts/deploy-coolify-production.ts`.
- [x] Canonical hosts, exact health SHA, Convex presence, QA picker, DNS-only
  request path, compatibility redirects, Search Console meta, and browser-proven
  GA opt-in/admin exclusion: `scripts/release-verify.ts`.
- [x] Pure governance contracts: `tests/release-governance.test.ts`.
- [x] Context-independent takeover state and privacy-safe evidence summary:
  `scripts/ops-status.ts`, `tests/ops-status.test.ts`.
- [x] Public exact-SHA health includes non-secret live voice cells:
  `app/api/health/route.ts`, `tests/health-route.test.ts`.
- [x] Docker binding and staging image isolation:
  `tests/dockerfile.test.ts`, `tests/deploy-coolify-host.test.ts`.
- [ ] Human Malaysian voice judgment remains manual and evidence-gated.
