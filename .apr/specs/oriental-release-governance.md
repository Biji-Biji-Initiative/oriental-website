# Oriental release governance — ship review

Review the repository-level release governance correction. The outcome is a
fast, fail-closed path that prevents the deployment drift and repeated manual
work observed during the previous release.

## Required contract

- Runtime code, tests, configuration contract, operator docs, specs, and
  relevant agent guidance MUST converge in one PR before its final merge SHA is
  frozen.
- A runtime release MUST start from a clean local `main` whose full 40-character
  HEAD equals `origin/main` and the requested release SHA.
- Staging and production MUST be verified through their canonical Mereka hosts.
  The legacy `*.deploy.mereka.io` application hosts are redirects only.
- Cloudflare MUST remain DNS-only; public responses MUST not contain evidence
  that Cloudflare is on the request path.
- Health proof MUST require the exact SHA, `ok: true`, `convex: true`, and the
  exact governed voice/capture contract for repeated checks. The public QA
  picker MUST remain off.
- Shared staging deploys MUST use optimistic concurrency against the live full
  SHA and a host-side nonblocking lock. A stale or simultaneous deployment MUST
  fail before image build or container mutation.
- At the production promotion boundary, staging and production MUST use the
  same source SHA. Staging may later move for another controlled experiment,
  and documentation MUST distinguish historical proof from current live state.
- Production MUST remain `baseline/control/low/adaptive` unless an evidence gate and
  human review explicitly authorize one changed experiment dimension. The
  production preflight MUST validate this by default, not through an optional
  operator flag.
- Operations/docs-only changes MUST NOT trigger a pointless application
  rebuild. Runtime and runtime-configuration changes MUST use staging then
  production, retaining the previous exact SHA as rollback.
- Ordinary direct-host production deployment MUST be rejected. Any break-glass
  host recovery MUST require an explicit emergency flag and the live full SHA.
- Normal production deployment MUST pin and read back Coolify's immutable
  commit, require live staging/current-production SHA preconditions, inspect
  the deployment record's full commit, wait for terminal success, and prove the
  new public production health SHA.
- The runbook MUST define bounded time targets, stop conditions, ownership of
  Infisical versus its materialized Coolify/staging copies, and acceptance
  criteria tied to executable tests or a named manual judgment.
- Model guidance MUST describe `gpt-realtime-2.1` as the first controlled
  quality candidate against the current `gpt-realtime-2` control, while
  `gpt-realtime-2.1-mini` remains a later speed/cost experiment.
- A fresh operator MUST be able to reconstruct local/main Git state, live
  staging and production SHAs/cells, deployed-SHA ownership, open PRs/issues,
  manual gates and owners, the latest APR verdict, and aggregate-only voice
  evidence without chat history. Missing evidence MUST fail closed and no
  credential may be sent to an application origin or included in output.

## Review request

Inspect the implementation evidence and governed runbook adversarially. Look
for race conditions, commands that cannot work as written, mutable or
ambiguous release identity, false current-state claims, weak verification,
unsafe environment assumptions, secret leakage, needless deployment work, or
policy prose with no executable enforcement. Ignore unrelated product feature
requests. Report concrete findings in severity order and end with exactly
`VERDICT: SHIP GOVERNANCE` or `VERDICT: DO NOT SHIP`.
