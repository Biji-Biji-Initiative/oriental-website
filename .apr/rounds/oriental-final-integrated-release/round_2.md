Gate result: **fail-closed as a pre-merge code gate**, not because post-merge live proof is missing, but because the supplied artifacts do not include the checked-out implementation needed for independent verification.

The attached runbook/evidence **does describe** the intended closure: tombstoned secret retirement and fail-before-mutation behavior, exact Coolify bulk-write acknowledgement with runtime/build/multiline scope, locked-value container verification, `OWNER_AI`/`OWNER_CULTURAL` retirement, principal-bound admin credentials, retention drain to `hasMore=false`, authenticated admin review proof, and rollback convergence are all specified or asserted. See `docs/12-CHAT-RELEASE-RUNBOOK.md:49-64`, `docs/12-CHAT-RELEASE-RUNBOOK.md:326-349`, `docs/12-CHAT-RELEASE-RUNBOOK.md:251-299`, `.apr/evidence/oriental-final-integrated-release.md:70-80`, `.apr/evidence/oriental-final-integrated-release.md:121-136`.

However, this review request requires verification “against the checked-out implementation,” and the provided files are release docs/spec/evidence rather than the deployer, Convex functions, admin auth, retention/erasure mutations, browser storage/analytics code, or tests under review. The spec itself frames this as an implementation merge review and treats incomplete secret convergence, weak authorization, privacy leakage, broken exact-SHA proof, and related gaps as blockers. See `.apr/specs/oriental-final-integrated-release.md:108-115`.

Two concrete evidence gaps also remain for this exact pre-merge gate:

- The evidence binds the implementation to a head/tree **before** an evidence-only update, so it is not proof for the complete current PR tree as submitted for this gate. `.apr/evidence/oriental-final-integrated-release.md:5-9`, `.apr/evidence/oriental-final-integrated-release.md:161`.
- The evidence claims transcript aggregates are capped at **8,000 characters**, but the requested gate asks for **byte-safe** indexed retention. Character caps do not independently prove byte safety for multibyte input without implementation/test evidence. `.apr/evidence/oriental-final-integrated-release.md:54-57`.

I am **not** blocking on the expected post-merge Convex/staging/production/live-container proof; those gates are properly called out as remaining operational release steps, and the user explicitly said not to require them for this code merge gate. `.apr/evidence/oriental-final-integrated-release.md:163-176`.

VERDICT: DO NOT MERGE
