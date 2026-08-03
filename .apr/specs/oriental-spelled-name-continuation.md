# Oriental explicitly spelled name continuation — review contract

## Required behavior

1. A visitor who explicitly introduces their name as individually spoken letters
   must retain exactly those letters when they immediately continue with an
   ordinary sentence.
2. A continuation pronoun such as `I am …` must not become part of the name.
3. Extraction remains fail-closed: ordinary prose without an explicit name cue
   must not create a name, and the bounded length limit remains in force.
4. This correction must not change email extraction, routing, or submission
   authority.

## Acceptance

- Extractor and live typed-chat state tests cover the continued-spelling case.
- Lint, typecheck, full unit tests, build, and staging no-submit voice/intake
  smokes pass before production deployment.
- APR ends with `VERDICT: SHIP SAFE DEFAULTS` or `VERDICT: DO NOT SHIP`.
