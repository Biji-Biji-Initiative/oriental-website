The implementation successfully fulfills the requirements of the aggregate-only voice audit contract.

Here is the adversarial breakdown against your listed concerns:

1. **Control-Flow Leaks**: You have cleanly isolated the `aggregate-only` path.
    * Human readable progress logs (`Evaluating X sessions...`), `printSummary()`, and error warnings are robustly guarded by `if (!args.aggregateOnly)`.
    * Setting `process.exitCode = 2` (followed by an early `return`) instead of `process.exit(2)` on `scripts/eval-voice.ts:286` is excellent. It safely prevents blocking synchronous standard output buffers, guaranteeing that the JSON document cleanly reaches CI parsers before the Node event loop closes.
    * Unexpected API drops in Infisical are caught by the `.catch` block on `scripts/eval-voice.ts:401`, piping standard error safely to `stderr` without contaminating the `stdout` aggregate file output.
2. **Hidden Identifier Fields**: Addressed systematically.
    * You explicitly `omitSessionAttention` over both top-level and cohort aggregates to mask arbitrary IDs within `worstSessions` (`scripts/lib/voice-eval-audit.ts:27-38`).
    * You use a mapped proxy payload `aggregateExperimentValidation` to scrub away individual review IDs inside experiment variation gates, replacing them with compliant generic strings (`scripts/lib/voice-eval-audit.ts:40-52`).
3. **Conflicting Flags**: Checked before network traffic begins (`scripts/eval-voice.ts:111-113`). A conflicting `--out` or `--persist` correctly hard-crashes, preventing unintended side effects. Setting `--aggregate-only` implicitly flips the system into a dry-run state internally (`scripts/eval-voice.ts:208`), safely bypassing the OpenAI instantiation even if the Infisical key fails to export.
4. **Empty-Corpus Behavior**: Correct.
    * By returning early when `rawSessions.length === 0` in detailed-mode (`scripts/eval-voice.ts:192-195`), you avoid writing an empty file payload.
    * By *bypassing* this early return in `aggregate-only` mode, you fulfill a major stability constraint: automation expecting JSON from `process.stdout` receives a valid, perfectly schema-compliant JSON file with zeroed aggregates, rather than failing on an empty string exit.
5. **Regressions to Detailed Evaluator**: None found.
    * Detailed logging, `writeFileSync` targets, full JSON transcripts layout, and LLM behavior act untouched when evaluated natively.

VERDICT: SHIP
