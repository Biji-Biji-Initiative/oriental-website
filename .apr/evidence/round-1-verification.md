# Oriental Instant Voice — round 1 verification evidence

Evidence date: 2026-07-15 (Asia/Kuala_Lumpur)

## Release identities

- Product implementation baseline:
  `d085cac0f649e8f718c5b9b4f43447869be59664`.
- APR workflow baseline:
  `2b58932bbe3df42c156ba2d2f022c578c1a99ba4`.
- Integration branch: `codex/voice-instant-e2e`.
- Merge vehicle: `https://github.com/Biji-Biji-Initiative/oriental-website/pull/13`.
- PRs 11 and 12 were closed as superseded by PR 13; their commits remain in the
  integration history.

## Repository verification

The product baseline passed:

- `pnpm lint`: 161 files clean.
- `pnpm typecheck`: passed.
- `pnpm exec tsc -p convex/tsconfig.json --noEmit`: passed.
- `pnpm test`: 35 files, 214 tests passed.
- `pnpm build`: Next.js 16.2.10 production build passed.
- Public Playwright suite: 28 passed, 10 admin-only tests skipped.
- Fixture-backed admin Playwright suite: 9 passed, 1 intentional mobile
  mutation test skipped.
- `git diff --check`: passed.

GitHub pull-request CI passed lint, typecheck, unit tests, secret scanning, and
production build:

- `https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/29407969787`

## Convex evidence

- Convex dry deploy completed with generated function typecheck and no index
  deletions.
- Convex schema/functions deploy completed at
  `https://wary-hornet-265.eu-west-1.convex.cloud` with release message
  `voice instant final schema d085cac`.
- Staging health reported `convex: true` after the web deployment.

## Canonical staging deployment

- Host-managed staging image:
  `mtrl2z6a7zvoyevxvufpntij:d085cac`.
- Canonical URL: `https://staging.oriental.mereka.io`.
- Root request returned HTTP 200 with no redirect.
- Health response after deployment:

```json
{"ok":true,"version":"d085cac","convex":true}
```

- No `deploy.mereka.io` application references remain in the repository.
- Staging logs after deployment and live smoke contained zero error lines.

## Real staging WebRTC smoke

Command: `pnpm smoke:staging:voice`

The smoke is hard-coded to refuse every target except canonical staging. It
uses a fake microphone only to grant media permission; the session, WebRTC peer,
OpenAI Realtime response, remote audio, typed interruption, and review snapshot
are all live staging paths. It never submits a lead.

```json
{
  "target": "https://staging.oriental.mereka.io",
  "version": "d085cac",
  "connectedMs": 3527,
  "openerAudioMs": 928,
  "interruptionRecoveryMs": 679,
  "remoteAudioTrackLive": true,
  "remoteAudioAdvanced": true,
  "sessionMintStatuses": [200, 200],
  "debugStatuses": [200, 200],
  "pageErrors": 0,
  "consoleErrors": 0
}
```

This proves transport, remote audio, typed cancellation/barge-in recovery, and
review persistence. It does not pretend to prove subjective Malaysian voice
quality; a human listener must approve that before merge.

## Live evaluation and production safety

- Read-only evaluation: 100 call rows, 90 conversations, zero dropped mid-turn,
  zero disconnects, and all observed sessions baseline/control-low.
- The advisory promotion gate correctly returned `insufficient_data` because
  no qualifying `instant-v1` sample set exists.
- Production health remained:

```json
{"ok":true,"version":"606f46e","convex":true}
```

- Production web was not promoted and remains baseline/control/low.
