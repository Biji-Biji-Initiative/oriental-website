# Evidence — explicitly spelled name continuation

## Exact change

The parser in `lib/voice/tentative-extraction.ts` now removes only a trailing
continuation pronoun when a visitor says an explicitly cued, individually
spelled name and immediately starts a normal sentence. The email parser,
Realtime routing reducer, and submission paths are unchanged.

## Executable proof

- `tests/tentative-extraction.test.ts` covers `G U R P R E E T I am …` and a
  name ending in `I` (`A L I I am …`).
- `tests/realtime-events.test.ts` proves the same input updates only the live
  name field, not email.
- Focused tests passed: 3 files, 1,595 assertions.
- Full validation passed before this evidence-only addition: Biome, TypeScript,
  91 test files / 2,350 assertions, and production build.
- Canonical staging no-submit intake and voice smokes passed at
  `196e191cf69e715bde58e3d511f66f92c716da9a` before the source correction.
