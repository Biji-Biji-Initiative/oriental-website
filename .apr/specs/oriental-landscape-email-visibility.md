# Oriental landscape email action visibility — merge gate

Review the focused post-release fix for the compact email editor in the
Oriental voice intake.

## Observed production defect

The browser-backed test against both canonical live hosts found that the
**Send enquiry** control was only `0.9943181872367859` visible at the
`844x390` short-landscape viewport. The email input itself was visible, but
browser focus scrolling could leave the adjacent Send control clipped at the
viewport edge.

## Required behavior

- Focusing or blurring the compact email input MUST reveal the entire compact
  editor, not only the input.
- The input, Send control, and validation/help copy MUST stay together across
  `320x568`, `390x844`, `844x390`, `1023x600`, `1024x390`, and `1024x600`.
- The Send control MUST be fully visible, enabled for a valid email, and retain
  a minimum `44x44` CSS-pixel target.
- The dialog MUST retain zero horizontal scroll and create no page overflow.
- Focus transfer across the 1024px breakpoint and the existing provenance,
  submission, accessibility, and validation behavior MUST remain unchanged.
- The fix MUST not weaken the exact `ratio: 1` browser assertion.

## Evidence

- Focused six-viewport regression: passed.
- Homepage Playwright suite: 21 passed.
- Unit suite: 80 files / 756 tests passed.
- Lint: 272 files clean.
- Typecheck: passed.

Review the attached exact one-file implementation patch. Treat clipped controls,
focus theft, scroll loops, horizontal overflow, accessibility regression, or a
test-only relaxation as blockers.

End with exactly `VERDICT: MERGE LANDSCAPE EMAIL FIX.` or
`VERDICT: DO NOT MERGE.`.
