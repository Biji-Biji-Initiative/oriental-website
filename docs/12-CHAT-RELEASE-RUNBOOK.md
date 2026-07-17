---
title: "Oriental Governed Release Runbook"
type: "release_spec_and_runbook"
status: "implemented"
owner: "Mereka Engineering"
last_updated: "2026-07-16"
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
  production or a historical document. Image tags remain distinct because
  staging may bake preview-only public flags.
- `staging.oriental.mereka.io` and `oriental.mereka.io` are canonical. The
  `*.deploy.mereka.io` names MUST remain redirects only.
- Cloudflare MUST remain authoritative DNS only; Coolify Traefik terminates TLS.
- Infisical is canonical configuration. Coolify's environment-variable store
  and staging's host-local `.env` are separate materialized copies and MUST be
  compared with Infisical before release.
- The production deployer MUST reconcile and read back the exact managed
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` and
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` values as Coolify build-and-runtime
  variables before changing the frozen SHA. The API credential therefore needs
  scoped `read:sensitive`, `write`, and `deploy` access; values are never logged.
- Production voice MUST remain `baseline/control/low/adaptive`. A staging-only
  model trial MUST be explicit, hold runtime/reasoning/capture constant, and
  never imply production promotion.
- A failed health check MUST stop the rollout. Never disable or weaken the gate
  to finish a release.

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

This mode performs only the Convex evaluation query, excludes synthetic smoke
rows, disables the LLM judge and Convex mutations, writes no report, and emits a
single aggregate/gate JSON document. It omits transcripts, contact data, session
identifiers, and identifier-bearing attention lists. `--persist` and `--out` are
rejected in this mode. PII-free tool-call telemetry is included as overall and
per-tool sample/outcome counts plus execution, response-to-call, and
response-to-result p50/p95 distributions.

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
  -- pnpm release:verify:voice-cell -- --model-cell candidate
infisical run \
  --domain https://secrets.mereka.io \
  --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
  --env prod \
  --path /deploy/oriental-website \
  -- pnpm release:verify:voice-cell -- --model-cell control
infisical run \
  --domain https://secrets.mereka.io \
  --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
  --env prod \
  --path /deploy/oriental-website \
  -- pnpm release:preflight -- --sha "$sha"
```

Managed-environment validation is the default. This staging preview requires
`baseline/candidate/low/adaptive` with `gpt-realtime-2.1`; production requires
`baseline/control/low/adaptive` with `gpt-realtime-2`. Both require the QA
picker off. `--allow-unmanaged` exists only
for testing the Git/static contract and MUST NOT be used as production release
evidence. The fast parity command runs against both native Infisical
environments before the full production-env preflight, preventing staging
source drift from being hidden by the deployer's host-side safe defaults.
The managed preflight deliberately runs Vitest through
`scripts/run-release-tests.ts`, which retains only process/tooling variables and
forces `NODE_ENV=test`. Live application secrets stay injected for
`check-secrets`, the production build, and the final SHA/cell checks, but cannot
select production React or leak notification/routing configuration into test
fixtures.

Once preflight passes, the SHA is frozen. Any runtime code, Docker, config, spec,
or runbook correction invalidates the freeze and restarts at Phase 1. Do not
create a late docs-only PR that changes the declared runtime release boundary;
include release docs before the first deployment.

## Phase 3 — Deploy dependencies and staging

1. Deploy Convex first only when the reviewed diff changes schema or functions.
2. Build the distinct `staging-<sha>` image and recreate host-managed staging:

   ```bash
   current_staging_sha="$(curl -fsS https://staging.oriental.mereka.io/api/health | jq -r .version)"
   scripts/deploy-coolify-host.sh --target staging \
     --expected-current-sha "$current_staging_sha" \
     --voice-model-cell candidate "$sha"
   ```

   The script rechecks that SHA while holding the host deployment lock. If
   staging moved, stop and coordinate with its current owner; never overwrite an
   unknown experiment. As part of the same atomic `.env` update, it materializes
   the selected governed non-secret voice cell. Candidate is legal only for
   staging and resolves to `baseline/candidate/low/adaptive`; every production
   host path rejects it. The picker is explicitly off and the full secret set
   must already be reconciled from Infisical.

3. Run the deterministic public verifier:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env staging \
     --path /deploy/oriental-website \
     -- pnpm release:verify -- --sha "$sha" --target staging \
       --staging-model-cell candidate
   ```

4. Run `pnpm smoke:staging:voice` when voice, OpenAI configuration, WebRTC,
   session persistence, or voice UI changed.
5. Inspect the running container—not only Infisical—for the expected revision,
   deployment environment, and voice cells.

Do not submit a staging lead casually: staging still shares production Convex,
OpenAI, Redis, and notification accounts.

## Phase 4 — Production

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
   the SHA, it validates the two Google public identifiers supplied by the
   application scope, creates or updates their production Coolify entries, and
   reads back exact values with build-time and runtime enabled. The deploy token
   must include `read:sensitive`; otherwise value parity fails closed without
   printing either identifier.
3. Require terminal `finished`; do not infer success from a queued build.
4. Verify both environments together:

   ```bash
   infisical run \
     --domain https://secrets.mereka.io \
     --projectId 6bfac905-9bb1-449e-8be8-f25f9634802b \
     --env prod \
     --path /deploy/oriental-website \
     -- pnpm release:verify -- --sha "$sha" --target both
   ```

   This browser-backed verifier requires Playwright Chromium (or
   `PLAYWRIGHT_CHROMIUM_PATH`). It proves the exact Search Console meta tag,
   observes no GA request before consent, observes the expected GA asset only
   after clicking **Allow analytics**, and proves an already-consented admin
   surface still emits no GA request.

5. Confirm Coolify reports `running:healthy`, its health-check host is
   `127.0.0.1`, and the production container exposes the intended runtime cells.
6. For voice releases, rerun the dry evaluator and report `insufficient_data`
   honestly when its minimum evidence gate is not met.

## Failure handling

| Symptom | Required response |
|---|---|
| CI fails | Fix in the same PR; do not deploy. |
| Staging health fails | Diagnose the image/container contract; production remains unchanged. |
| Coolify candidate health fails | Keep the old container serving; inspect binding, probe host, logs, and runtime env. |
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
  `staging-<sha>` image.
- Convex: use backward-compatible schema/function changes; never assume an app
  image rollback also rolls back Convex.

## Acceptance criteria mapping

- [x] Exact SHA, clean `main`, image-tag, health-binding, runbook, and mandatory
  managed-cell checks: `scripts/release-preflight.ts`.
- [x] Exact staging/current-production preconditions, managed Google public
  build-variable reconciliation/readback, immutable Coolify commit pin/readback,
  deployment-record commit, terminal status, and post-deploy production health:
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
