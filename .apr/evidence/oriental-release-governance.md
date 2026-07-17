# Oriental release governance — implementation evidence

## Implemented boundaries

- `.github/PULL_REQUEST_TEMPLATE.md` classifies runtime versus operations/docs
  work, requires acceptance evidence and rollback, and reserves APR for
  high-risk cross-layer changes.
- `AGENTS.md`, `README.md`, `docs/02-TECHNICAL-SPEC.md`,
  `docs/09-LAUNCH-CHECKLIST.md`, `docs/11-INFRASTRUCTURE.md`,
  `docs/12-CHAT-RELEASE-RUNBOOK.md`, `docs/13-VOICE-INSTANT-RELEASE-SPEC.md`,
  and `docs/README.md` now agree on canonical hosts, DNS-only Cloudflare,
  Coolify/Infisical materialization, exact-SHA release flow, current model
  experiment order, live-versus-historical evidence, and unresolved human
  gates.
- `package.json` exposes the full `release:preflight` gate, exact production
  deployer, and public `release:verify` command.

## Shared staging concurrency

The staging deploy entrypoint now requires a full live SHA from the operator:

```bash
if ! [[ "$expected_current_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Host deploys require --expected-current-sha with the full currently deployed SHA." >&2
  exit 2
fi

if [[ "$target" == "production" && "$allow_emergency_production" != "true" ]]; then
  echo "Production deploys must use the Coolify API. Host deployment is break-glass only." >&2
  exit 2
fi
```

It passes that value as a quoted positional argument to the remote Bash
process. Before cloning, building, writing `.env`, or recreating a container,
the remote process obtains a host lock and compares the currently materialized
source SHA:

```bash
if [[ "$target" == "staging" ]]; then
  target_dir="$staging_dir"
else
  target_dir="$prod_dir"
fi
mkdir -p "$target_dir"
exec 9>"$target_dir/.deploy.lock"
if ! flock -n 9; then
  echo "Another host deployment holds $target_dir/.deploy.lock." >&2
  exit 1
fi
current_sha="$(sed -n 's/^SOURCE_COMMIT=//p' "$target_dir/.env" | tail -1)"
if [[ "$current_sha" != "$expected_current_sha" ]]; then
  echo "${target^} moved: expected $expected_current_sha but host has ${current_sha:-unset}." >&2
  exit 1
fi
```

The target host was checked read-only and provides `/usr/bin/flock`. Its live
`SOURCE_COMMIT` was
`17992e88405c29b5f800da30922a39d87d9495f9`; the governance work did not
overwrite that separately owned staging experiment.

The same host helper rejects ordinary `--target production` use. Break-glass
host recovery additionally requires `--allow-emergency-production`, a full
live production SHA, and the same nonblocking host lock/current-SHA check.
Normal production deployment remains the Coolify API path.

## Pure release contracts

`scripts/lib/release-governance.ts` defines immutable target truth and pure
validators:

```ts
export const CONTROL_VOICE_CELL = {
  runtimeProfile: "baseline",
  modelCell: "control",
  reasoningCell: "low",
  emailCaptureMode: "adaptive",
} as const;

export const RELEASE_TARGETS = {
  staging: {
    origin: "https://staging.oriental.mereka.io",
    legacyOrigin: "https://oriental-staging.deploy.mereka.io",
  },
  production: {
    origin: "https://oriental.mereka.io",
    legacyOrigin: "https://oriental.deploy.mereka.io",
  },
} as const;

export function validateReleaseSha(value: string): string[] {
  return /^[0-9a-f]{40}$/.test(value) ? [] : ["release SHA must be a full 40-character lowercase git SHA"];
}

export function validateHealthPayload(payload: unknown, expectedSha: string): string[] {
  if (!payload || typeof payload !== "object") return ["health response must be an object"];
  const health = payload as Record<string, unknown>;
  const failures: string[] = [];
  if (health.ok !== true) failures.push("health response ok must be true");
  if (health.version !== expectedSha) failures.push(`health response version must equal ${expectedSha}`);
  if (health.convex !== true) failures.push("health response convex must be true");
  const voice = health.voice && typeof health.voice === "object" ? (health.voice as Record<string, unknown>) : null;
  if (!voice) failures.push("health response voice must be an object");
  // The implementation checks runtime_profile/model_cell/reasoning_cell/
  // email_capture_mode and variant_picker against CONTROL_VOICE_CELL.
  return failures;
}

export function hasCloudflareEdgeHeaders(headers: Headers): boolean {
  const server = headers.get("server")?.toLowerCase();
  return Boolean(headers.get("cf-ray") || headers.get("cf-cache-status") || server?.includes("cloudflare"));
}
```

`validateManagedVoiceCell` additionally requires exact
`baseline/control/low/adaptive` and rejects `VOICE_VARIANT_PICKER=true`.
`validateHealthPayload` independently reads back those same public health
fields, so a materialized Infisical/Coolify drift cannot pass on SHA alone.

## Preflight

`scripts/release-preflight.ts`:

- accepts only a full SHA and validates the managed release cell by default;
- compares that SHA with `git rev-parse HEAD` and `git rev-parse origin/main`;
- requires branch `main` and an empty `git status --porcelain`;
- checks the Docker bind address, distinct staging tag, Coolify health host,
  and final-SHA runbook contract;
- reserves explicit `--allow-unmanaged` for testing the Git/static contract;
- emits structured JSON on success and all accumulated failures on error.

The package command deliberately runs lint, typecheck, all tests, secret
contract validation, and a production build before the Git/release contract.

## Exact production deployment

`scripts/deploy-coolify-production.ts` requires the frozen full SHA, the live
full production rollback SHA, `COOLIFY_API_TOKEN`, and HTTPS. Before mutating
Coolify it fetches `origin/main`, proves the candidate is an ancestor, requires
staging health on the candidate, and requires production health on the stated
rollback SHA. It then:

1. verifies the Coolify UUID, `main` branch, and Oriental repository;
2. PATCHes `git_commit_sha` to the frozen SHA and reads it back;
3. POSTs the application start endpoint;
4. polls the returned deployment UUID and cancels on any different reported
   commit or timeout;
5. requires terminal `finished` with the full frozen commit;
6. requires public production health to expose the same full SHA.

The normal path uses the operator-only token from Infisical
`/platform/coolify`; the token is never printed or written to disk. Pure URL,
commit, and terminal-status contracts are covered by
`tests/coolify-release.test.ts`.

## Public verification

`scripts/release-verify.ts` uses a bounded 10-second timeout per request and
performs one to ten repeated health checks. For each selected environment it:

1. requires HTTP 200 from `/api/health` and validates exact SHA, `ok`, and
   Convex health;
2. requires HTTP 200 from `/api/client-config` and
   `voiceVariantPicker === false`;
3. requires HTTP 200 from the canonical root and rejects `cf-ray`,
   `cf-cache-status`, or a Cloudflare `server` header;
4. fetches the legacy root without following redirects and requires an exact
   301 location to the canonical root.

For `--target both`, `main()` explicitly expands the alias to
`["staging", "production"]` before indexing `RELEASE_TARGETS`; the alias is not
used as a map key.

The verifier passed three consecutive checks against production SHA
`bb8e2673e5f129f342fba78f3eb653a54de8763b` and, separately, against shared
staging SHA `17992e88405c29b5f800da30922a39d87d9495f9`.

## Context-independent takeover

`pnpm --silent ops:status --json` rebuilds current operational state from Git,
the public canonical health endpoints, GitHub's API, checked-in APR rounds, and
the newest local aggregate-only voice-eval report. Its output includes local
and `origin/main` SHAs, worktree divergence, live staging/production SHAs and
voice cells, containing branches and associated PRs, open PRs/issues, labeled
manual gates with assignees, latest APR verdict, and the fail-closed voice gate.

The GitHub bearer token is only attached when the URL host is exactly
`api.github.com`; tests prove it is omitted for `oriental.mereka.io`. The voice
summary selects only explicit aggregate/gate fields and never copies sessions,
transcripts, or visitor data. Missing/unreadable reports resolve to
`insufficient_data`. Partial network failures become warnings rather than false
passes. The current command correctly flags that shared staging SHA `17992e8`
is not on `origin/main` and has no associated PR.

`GET /api/health` now reports only non-secret runtime/model/reasoning cell,
selected model, and picker state alongside the existing SHA/Convex signal.
This is a runtime change and therefore requires exact-SHA staging and
production deployment after merge.

## Verification performed

- `bash -n scripts/deploy-coolify-host.sh`
- a live deliberately stale staging expectation exited `1` with
  `Staging moved` and reported the untouched live SHA before any build
- `pnpm lint`: 185 files, no findings
- `pnpm typecheck`: passed
- `pnpm exec vitest run --maxWorkers=4`: 48 files and 279 tests passed
- `pnpm build`: production build passed
- focused tests cover release targets, full-SHA validation, managed voice
  cells, health payloads, Cloudflare headers, Coolify URL/deployment states,
  staging lock text, and distinct image tags
- `git diff --check`: passed

## APR round 2 correction closure

Round 2 correctly blocked the vague production API step and optional managed
cell gate. The exact production deployer and default-on cell validation above
close both findings. Its third claim—that `--target both` indexes a nonexistent
map key—was disproven against the implementation: `main()` expands the alias
before lookup, and a focused source-contract test now prevents that evidence
from being omitted or regressing.

The earlier release-governance PR was operations/docs-only. The takeover
extension changes the public health response and is classified as runtime: it
must be deployed through staging and production after merge.
