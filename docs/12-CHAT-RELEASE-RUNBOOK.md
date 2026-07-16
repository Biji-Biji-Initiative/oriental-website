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
- Production voice MUST remain `baseline/control/low` unless the experiment
  gate and human review explicitly authorize a single-dimension trial.
- A failed health check MUST stop the rollout. Never disable or weaken the gate
  to finish a release.

## Context-independent takeover

Start every new operator or agent session with:

```bash
pnpm --silent ops:status --json
```

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
  --env prod \
  --path /deploy/oriental-website \
  -- pnpm release:preflight -- --sha "$sha"
```

Managed-environment validation is the default and requires explicit
`baseline/control/low` plus the QA picker off. `--allow-unmanaged` exists only
for testing the Git/static contract and MUST NOT be used as production release
evidence.

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
     --expected-current-sha "$current_staging_sha" "$sha"
   ```

   The script rechecks that SHA while holding the host deployment lock. If
   staging moved, stop and coordinate with its current owner; never overwrite an
   unknown experiment.

3. Run the deterministic public verifier:

   ```bash
   pnpm release:verify -- --sha "$sha" --target staging
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
     --path /platform/coolify \
     -- pnpm release:deploy:production -- \
       --sha "$sha" \
       --expected-current-sha "$current_production_sha"
   ```

   The deployer fails unless staging currently runs the candidate SHA,
   production still runs the expected rollback SHA, and the candidate is an
   ancestor of `origin/main`. It pins Coolify's `git_commit_sha`, reads it back,
   starts the application, and refuses success unless the deployment record and
   public production health both resolve to the full frozen SHA.
3. Require terminal `finished`; do not infer success from a queued build.
4. Verify both environments together:

   ```bash
   pnpm release:verify -- --sha "$sha" --target both
   ```

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
- Staging: restore the timestamped Compose/`.env` backup or previous
  `staging-<sha>` image.
- Convex: use backward-compatible schema/function changes; never assume an app
  image rollback also rolls back Convex.

## Acceptance criteria mapping

- [x] Exact SHA, clean `main`, image-tag, health-binding, runbook, and mandatory
  managed-cell checks: `scripts/release-preflight.ts`.
- [x] Exact staging/current-production preconditions, immutable Coolify commit
  pin/readback, deployment-record commit, terminal status, and post-deploy
  production health: `scripts/deploy-coolify-production.ts`.
- [x] Canonical hosts, exact health SHA, Convex presence, QA picker, DNS-only
  request path, and compatibility redirects: `scripts/release-verify.ts`.
- [x] Pure governance contracts: `tests/release-governance.test.ts`.
- [x] Context-independent takeover state and privacy-safe evidence summary:
  `scripts/ops-status.ts`, `tests/ops-status.test.ts`.
- [x] Public exact-SHA health includes non-secret live voice cells:
  `app/api/health/route.ts`, `tests/health-route.test.ts`.
- [x] Docker binding and staging image isolation:
  `tests/dockerfile.test.ts`, `tests/deploy-coolify-host.test.ts`.
- [ ] Human Malaysian voice judgment remains manual and evidence-gated.
