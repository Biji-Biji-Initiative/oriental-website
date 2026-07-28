# Oriental email-grounding PR 79 exact-source evidence

## Immutable implementation identity

- source implementation commit:
  `590807c5e9cbd4d179423d77a376df26787e1d86`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `ad5377ac28d22b29f0599269e01f90f8061855f5`
- complete source-only patch:
  `.apr/evidence/oriental-email-grounding-pr79.patch`
- patch SHA-256:
  `3bd65776c4fe29f3e0060ccc8e2bd663e35a12b075a03338965d6bf83024faba`

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

The candidate's literal selection, digit context, and following disposition are
scoped to the exact candidate window and decision clause. Explicit digit intent
selects only the numeric interpretation; it cannot authorize a literal-word
mailbox. Digit context must attach directly to the email candidate, and any
preceding negation in the decision text denies it. An unrelated literal address,
an earlier numeric sentence, room-number language, or long-range negated digit
language cannot authorize a numeric mailbox. `to`/`too`/`for` homophones cannot
introduce unspoken `2`/`4` digits even when another word supplies explicit digit
context.

The approximate matcher retains every equal-minimum-distance candidate in
chronological order. Scratch, ignore, retract, take-back, cancel, replace,
change, and switch dispositions apply to their candidate; a later explicit
restatement can supersede an earlier rejection, while a later rejection defeats
an earlier candidate. Both orderings are tested for every disposition.

## Verification evidence

Against source implementation commit
`590807c5e9cbd4d179423d77a376df26787e1d86`:

- `pnpm lint`: passed, 280 files, no warnings;
- strict TypeScript: passed;
- reducer suite: 1 file and 1,585 tests passed;
- production Next.js 16.2.10 build: passed;
- all other branch-local tests passed with the two previously known cross-PR
  macOS platform cells excluded; both cells are repaired by PR 78/82 and pass
  without exclusions in the integrated proof below;
- `git diff --check`: passed;
- GitHub `verify`: success on exact source head
  `590807c5e9cbd4d179423d77a376df26787e1d86`.

The synthetic eight-PR integration commit
`470dd990f0078ecca55c4475b4be80cf602c784f`, tree
`22c331f96cb46187870d572386b1cab5f7d27504`, passed frozen pnpm 10.34.5
installation, warning-free lint on 293 files, strict TypeScript, a zero-finding
production audit across 378 dependencies, all 89 test files and 2,333 tests,
and the Next.js 16.2.12 production build.

APR round 1 correctly rejected candidate-turn correction bypass, exact-path
reopening, word/numeric mailbox collision, and missing hostile chronology
coverage. Round 2 correctly rejected unrelated-context suppression,
equal-length homophone-to-digit approximation, and same-turn retraction or
replacement acceptance. Round 3 correctly rejected literal alternatives under
explicit digit intent, non-local and negated digit context, mixed explicit
homophones, and single-window approximate disposition handling. The repaired
implementation and hostile matrix above close every source blocker. Round 4
must review this regenerated exact patch and evidence.

## Release boundary

Source approval is not runtime quality proof. After all PRs merge, the exact
default-branch SHA must pass the full combined test/build/security gate,
canonical staging voice smoke, and guarded production promotion.
