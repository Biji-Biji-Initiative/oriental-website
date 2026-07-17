# Aggregate-only voice evidence audit ship contract

## Goal

Let operators inspect the live Convex voice corpus without creating another
transcript-bearing artifact or writing evaluation results.

## Required behavior

1. `pnpm eval:voice -- --aggregate-only --limit N` performs the existing
   `voiceSessionsForEval` Convex query and excludes the same synthetic smoke rows
   as the full evaluator.
2. Aggregate-only mode never invokes the OpenAI judge, never calls a Convex
   mutation, and never writes a report or any other filesystem artifact.
3. Standard output is exactly one JSON document. Convex function logging and
   human progress messages cannot contaminate it.
4. The JSON contains only counts, aggregates, controlled cohort names, and gate
   results. It never contains transcripts, captured contact data, review IDs,
   session IDs, conversation IDs, or identifier-bearing attention lists.
5. Experiment-validation failures are represented as an aggregate invalid-row
   count and a generic reason, not the existing per-review-ID messages.
6. `--persist` and explicit `--out` are rejected before environment validation
   or network access when aggregate-only mode is selected.
7. The existing detailed and dry evaluation paths retain their current behavior.
8. Focused subprocess tests prove query-only traffic, synthetic exclusion,
   identifier-free parseable JSON, no working-directory writes, and fail-closed
   conflicting flags.

## Documentation

`AGENTS.md` and the release runbook document the exact command and privacy/no-
write contract. This is operations-only and must not trigger an application
deployment.

## Verification

Biome, strict TypeScript, the full Vitest suite, and the production build pass.
