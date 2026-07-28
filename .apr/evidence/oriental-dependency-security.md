# Oriental dependency security exact-tree evidence

## Immutable implementation identity

- implementation commit:
  `bcd50efba4e330c58b9df496eb65f9ee9c9df825`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `10d520f0ceedfe0a42825005373ffea357196f92`
- authoritative source-only patch:
  `.apr/evidence/oriental-dependency-security.patch`
- patch SHA-256:
  `912d0d1258351358404395ba4e52a97b6d9c5e5d0b8f850e4a37cab3abc79ad0`

The patch changes exactly:

1. `.github/workflows/ci.yml`
2. `next.config.ts`
3. `package.json`
4. `pnpm-lock.yaml`
5. `tests/dependency-security.test.ts`

The obsolete mail patch was removed. The authoritative patch excludes `.apr/`,
so saved review rounds cannot alter its bytes. Any child after the
implementation commit must touch only `.apr/`. APR must compare the final PR
head with its clean worktree, and GitHub CI must pass on the final exact head.

## Reproducible audit toolchain

The repository and CI explicitly pin `pnpm@10.33.0`. CI now records:

```text
pnpm --version
pnpm config get registry
```

immediately before the mandatory audit. The audit command is:

```text
pnpm audit --prod --audit-level=high --json
```

so every run records machine-readable advisory and dependency counts in the
job log.

The assertion that pnpm 10.33.0 cannot currently complete the audit is
contradicted by live exact-head GitHub execution:

- run: `30338953872`
- exact PR merge ref source contained evidence head
  `0430de2253d6185f620028e705b2a5bd99c3926e`
- `pnpm/action-setup@v5` installed exactly `10.33.0`
- `pnpm audit --prod --audit-level=high` completed successfully
- output: `No known vulnerabilities found`
- full Linux job, including performance checks, completed `SUCCESS`

The current implementation additionally ran the JSON form locally with the
same pnpm version and `https://registry.npmjs.org/`, returning exit `0` and:

```json
{
  "advisories": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0
    },
    "dependencies": 378,
    "devDependencies": 0,
    "optionalDependencies": 0,
    "totalDependencies": 378
  }
}
```

Final exact-head CI remains mandatory and will repeat the pinned version,
registry, JSON audit, full tests, build, and Linux performance job.

## Precise patched dependency set

The overrides are scoped to the vulnerable resolution or vulnerable semver
range rather than applied graph-wide:

- `brace-expansion@5.0.7` -> `5.0.8`
- `fast-uri@3.1.3` -> `3.1.4`
- `postcss@<8.5.18` -> `8.5.23`
- `sharp@0.34.5` -> `0.35.3`

The PostCSS range deliberately covers Next's production `8.4.31` edge as well
as the prior `8.5.15` edge. During hardening, an exact-only 8.5.15 override
caused the machine-readable production audit to expose two live high advisories
through `next>postcss`; the range-scoped fix removed both. That failure is
evidence that the audit is executing the real frozen production graph.

The frozen lockfile contains only these governed patched resolutions:

- `brace-expansion@5.0.8`
- `fast-uri@3.1.4`
- `postcss@8.5.23`
- `sharp@0.35.3`

It contains no governed package/snapshot resolution for `brace-expansion
5.0.7`, `fast-uri 3.1.3`, `postcss 8.4.31/8.5.15`, or `sharp 0.34.5`.
Next.js, `eslint-config-next`, and `@next/eslint-plugin-next` remain aligned at
`16.2.12`.

`tests/dependency-security.test.ts` reads the actual lockfile package/snapshot
sections. It proves the patched resolutions are present, the vulnerable
resolutions are absent, the override map is exactly the four scoped entries,
the package-manager pin and CI setup agree, version/registry evidence is
mandatory, the audit is JSON, and Sharp tracing remains configured.

## Standalone native-runtime proof

`next.config.ts` uses the supported `outputFileTracingIncludes` mechanism:

```ts
outputFileTracingIncludes: {
  "/*": ["node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*"],
},
```

Completed against the current implementation:

- frozen install: pass
- lint: pass, 281 files
- typecheck: pass
- dependency security tests: 1 file and 4 tests passed
- machine-readable production audit: pass, zero vulnerabilities
- Next.js 16.2.12 production build: pass
- standalone Sharp load: `sharp=0.35.3`, `vips=8.18.3`
- standalone output contains native binding and libvips package assets
- `git diff --check`: pass

The prior exact implementation also started the standalone server and requested
a real repository JPEG through `/_next/image`, receiving HTTP 200,
`image/jpeg`, and 28,550 bytes. The tracing and dependency versions are
unchanged; final staging must repeat the external image endpoint proof on the
exact deployed SHA.

## Release boundary

This source change does not authorize deployment. After every PR merges, the
exact default-branch SHA must pass managed preflight, canonical staging
deployment, Sharp/libvips and real image-optimizer proof, full application
verification, and guarded production promotion with rollback retained.
