## Outcome

<!-- State the user-visible or operational result, not only the files changed. -->

## Scope and evidence

- [ ] This PR has one coherent outcome and no unrelated refactors.
- [ ] Runtime-impacting code, specs, runbooks, and `AGENTS.md` changes are included together.
- [ ] Acceptance criteria map to automated tests or an explicit manual verification step.
- [ ] Failure modes, observability, rollout, and rollback are documented when relevant.
- [ ] High-risk cross-layer changes received adversarial review before merge.

## Verification

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm check-secrets` when the environment contract changed
- [ ] `pnpm build` when runtime code or build configuration changed

## Release classification

- [ ] Runtime release: freeze the final merge SHA and follow `docs/12-CHAT-RELEASE-RUNBOOK.md`.
- [ ] Operations/docs-only: explain why an application deployment is unnecessary.

Runtime release SHA: `not-yet-merged`

Rollback boundary: <!-- previous exact image/SHA or configuration value -->
