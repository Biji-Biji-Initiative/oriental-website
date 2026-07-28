# Oriental email-grounding PR 79 exact-tree evidence

## Immutable implementation identity

- implementation head:
  `87202cc4ec4cd9e017434eab68865fc8d79b9325`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `6d28199606eb0e9a824ec273aad075ffd990d07e`
- complete patch:
  `.apr/evidence/oriental-email-grounding-pr79.patch`
- patch SHA-256:
  `9a7c16dcf372ef547cd7ac2d501c8ad9d819fea936d152539deaf557fccf6e34`

The implementation changes only `lib/voice/realtime-events.ts` and
`tests/realtime-events.test.ts`. Any evidence-only child commits must touch only
`.apr/`. APR must compare the remote PR head with its clean worktree, and
GitHub CI must pass on the final exact PR head.

## Behavior change

The exact email-grounding path already searches the bounded recent-user-turn
window because a `capture_field` tool call can arrive after the turn that
contained the address. The ASR-drift path incorrectly searched only the latest
turn. It now searches the same bounded window while retaining:

- email-speech cue requirement;
- bounded substitution distance;
- embedded-address collision rejection;
- literal-email mismatch rejection;
- rejection when a later turn supersedes the candidate address;
- all strict-mode and typed/prefill authority rules.

Candidate-turn correction-language heuristics are intentionally not reused
because phrases such as "it's" are ordinary first-statement language and would
reject valid email evidence. Later turns are still checked for supersession.

The second commit folds only the exact spoken digit words zero through nine
into numerals during evidence canonicalization. It does not map ambiguous
homophones such as `to`, `too`, or `for`, and it never rewrites the stored email.

## Verification evidence

- exact-head GitHub CI: passed before this evidence-only commit
- lint: passed
- strict TypeScript: passed
- focused reducer suite: 1,526 tests passed at PR creation
- synthetic integration: all 2,208 tests passed with PRs 78 through 85
- `git diff --check`: passed

Regression coverage includes delayed capture with bounded ASR drift, spoken
digits, zero-evidence invention, literal mismatch, embedded collisions,
one-character drift, correction ordering, strict/adaptive modes, and stored
value preservation.

## Release boundary

This source approval is not a runtime quality claim. After all PRs merge, the
exact default-branch SHA must pass the full combined test/build/security gate,
canonical staging voice smoke, and guarded production promotion.
