# Oriental dependency security exact-tree evidence

## Immutable implementation identity

- Implementation commit:
  `48fd87305ca6a188ad3577c4ac24f38a140800cd`
- Base commit:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- Implementation tree:
  `23c648c73e002efedecd546f21d5d1e4b44f4108`
- Complete mail patch:
  `.apr/evidence/0001-fix-deps-patch-production-advisories.patch`
- Patch SHA-256:
  `f23a4c40e3a1d23dafa05857437c064358357722d09a5059646526854bb5dab5`

The implementation changes exactly five files:

1. `.github/workflows/ci.yml`
2. `next.config.ts`
3. `package.json`
4. `pnpm-lock.yaml`
5. `tests/dependency-security.test.ts`

Any evidence-only child commits must touch only `.apr/`. APR must compare the
remote PR head with its clean review worktree, and GitHub CI must pass on the
final exact PR head.

## Patched dependency set

- `next`: `16.2.12`
- `eslint-config-next`: `16.2.12`
- `sharp`: `0.35.3`
- `postcss`: `8.5.23`
- `fast-uri`: `3.1.4`
- `brace-expansion@5.0.7`: overridden to `5.0.8`

The versions are explicit `pnpm.overrides`, not a mutable install-time
assumption. The frozen lockfile records the resolved graph.

## CI and regression boundary

`package.json` defines:

```json
"audit:prod": "pnpm audit --prod --audit-level=high"
```

The CI workflow invokes `pnpm audit:prod` immediately after
`pnpm install --frozen-lockfile`, while retaining lint, typecheck, Vitest,
production build, and performance checks.

`tests/dependency-security.test.ts` proves:

- the four transitive overrides and their exact patched versions;
- CI invokes the production audit;
- standalone output tracing includes Sharp's native packages.

## Standalone native-runtime boundary

Sharp `0.35.x` separates platform packages containing the native binding and
libvips. The first patched build compiled but omitted the libvips dynamic
library from `.next/standalone`, causing a real Sharp load to fail.

`next.config.ts` now uses Next.js' supported `outputFileTracingIncludes`
mechanism:

```ts
outputFileTracingIncludes: {
  "/*": ["node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*"],
},
```

This is scoped to the missing Sharp native packages rather than copying the
entire dependency tree.

## Verification completed

Against implementation commit
`48fd87305ca6a188ad3577c4ac24f38a140800cd`:

- `pnpm install --frozen-lockfile`: pass
- `pnpm audit:prod`: pass, no known vulnerabilities
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- dependency security tests: 1 file, 3 tests passed
- `pnpm build`: pass under Next.js 16.2.12
- standalone Sharp load: `sharp=0.35.3`, `vips=8.18.3`
- standalone health endpoint: HTTP 200
- standalone `/_next/image` request for a real repository JPEG: HTTP 200,
  `image/jpeg`, 28,550 bytes
- `git diff --check`: pass

Local performance execution did not claim success: the downloaded macOS
Chromium artifact returned `ENOEXEC`. The unchanged Linux GitHub CI performance
job remains authoritative and must pass on the final exact head.

The full synthetic integration of PRs 78 through 85 also passed production
audit, lint, typecheck, 86 Vitest files with 2,208 tests, and the Next.js
production build.

## Release boundary

This PR changes application dependencies and the built standalone artifact but
does not authorize a deployment by itself. After every PR merges, the exact
default-branch SHA must pass managed preflight, canonical staging deployment
and verification, and guarded production promotion with rollback retained.
