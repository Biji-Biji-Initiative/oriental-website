# Oriental email-grounding PR 79 exact-source evidence

## Immutable implementation identity

- source implementation commit:
  `56641b29937db8791aab8a838b78d04b940106c3`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `8eed8d91e0cb8c2b1ed47a1a93437d929b0f5e15`
- complete source-only patch:
  `.apr/evidence/oriental-email-grounding-pr79.patch`
- patch SHA-256:
  `3897f91c5c574eb9e421d229d493142cd597298bdbc40fdb24931b61b6cbf0c7`

The source range changes only `lib/voice/realtime-events.ts` and
`tests/realtime-events.test.ts`. An earlier APR evidence commit is in the
branch ancestry; the regenerated source-only patch above is the complete
review boundary. Any descendant after the implementation commit may touch only
`.apr/`. APR must compare the remote PR head with this implementation plus
APR-only descendants, and GitHub CI must pass on the final exact PR head.

## Delayed approximate grounding

Exact email evidence already searches the bounded six-user-turn window because
a `capture_field` tool call can arrive after the turn containing the address.
Approximate ASR evidence now uses that same window, but only when:

- the candidate has a complete email speech cue;
- substitution distance is greater than zero and within the bounded edit cap;
- it is neither an embedded-address collision nor a different literal address;
- the candidate turn does not say `no`, `not`, `instead`, `rather than`,
  `wrong`, `incorrect`, `do not use`, `forget`, or another unambiguous
  rejection;
- an exact address rejected by the exact path cannot reopen through the
  approximate path; and
- no later turn supersedes the candidate.

The broader correction helper is intentionally not used as the sole candidate
guard because ordinary first-time language such as “it’s” is also a discourse
cue. The new guard rejects unambiguous correction semantics without making
that valid first statement impossible.

Hostile tests cover candidate-turn rejection, a turn containing both rejected
and selected literal addresses, an exact-path reopening attempt, embedded and
different-address older turns, a later typed replacement, strict mode, and an
address just outside the six-turn window.

## Spoken digit ambiguity

Spoken `zero` through `nine` now produce two bounded interpretations:

- the literal word mailbox, such as `one@example.com`; and
- the numeric mailbox, such as `1@example.com`.

When both interpretations are valid and either matches the model value, the
capture remains medium-confidence and unrouteable in adaptive mode; strict
mode keeps it behind explicit confirmation. It can become high confidence only
when the same decision clause explicitly calls the words digits, numbers, or
numerals. A literal typed email remains exact authority.

`to`, `too`, and `for` are never numeric interpretations. Tests exercise
`one`/`1`, `two`/`2`, `samone`/`sam1`, and the `to`/`too`/`for` homophone
cases through the complete bounded matcher. Stored email values are never
rewritten by the evidence canonicalizer.

## Verification evidence

Against source implementation commit
`56641b29937db8791aab8a838b78d04b940106c3`:

- `pnpm lint`: passed, 280 files;
- strict TypeScript: passed;
- reducer suite: 1 file and 1,547 tests passed;
- production Next.js 16.2.10 build: passed;
- `git diff --check`: passed.

The hermetic full suite ran 83 files and 2,212 tests successfully; its only
local failure was the pre-existing macOS `{20,256}` regex portability defect in
the host rollback test. PR #78 owns that defect and is required to merge before
this PR; the combined tree must rerun the complete suite. Exact-head GitHub CI
and that combined-tree proof remain mandatory.

APR round 1 correctly rejected candidate-turn correction bypass, exact-path
reopening, word/numeric mailbox collision, and missing hostile chronology
coverage. The implementation above closes each source blocker. Round 2 must
review this regenerated exact patch.

## Release boundary

Source approval is not runtime quality proof. After all PRs merge, the exact
default-branch SHA must pass the full combined test/build/security gate,
canonical staging voice smoke, and guarded production promotion.
