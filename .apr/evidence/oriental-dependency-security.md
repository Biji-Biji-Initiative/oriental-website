# Oriental dependency security exact-tree evidence

## Immutable implementation identity

- implementation commit:
  `5455169e5c3560101f2178617568c1795926a26f`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `fa97ff36be2e411b5fab504fcde40688cb8ffd81`
- authoritative source-only patch:
  `.apr/evidence/oriental-dependency-security.patch`
- patch SHA-256:
  `3f83799a2f724abd6230c180ecb1e7474e967b578bfdb502fe38f62d3c76b691`

The patch changes exactly six files: the CI workflow, `next.config.ts`,
`package.json`, `pnpm-lock.yaml`, the dependency-security suite, and its parsed
lockfile audit helper.

The obsolete mail patch was removed. The authoritative patch excludes `.apr/`,
so saved review rounds cannot alter its bytes. Any child after the
implementation commit must touch only `.apr/`. APR must compare the final PR
head with its clean worktree, and GitHub CI must pass on the final exact head.

## Reproducible audit toolchain

The repository and CI explicitly pin patched `pnpm@10.34.5`. CI records:

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

The current exact implementation ran the JSON audit with pnpm 10.34.5 and
`https://registry.npmjs.org/`, returning exit `0` and:

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

Final exact-head CI repeated the pinned version, registry, JSON audit, full tests,
build, and Linux performance job successfully.

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

`tests/dependency-security.test.ts` parses the effective YAML with the pinned
`yaml` library and evaluates governed versions with `semver`. It independently
audits `packages`, `snapshots`, every governed snapshot dependency edge, and the
complete production-only closure starting at the root importer's dependencies
and optional dependencies.

Only concrete registry references with valid semantic versions and balanced,
substantive pnpm peer/patch suffixes are accepted. A well-formed `npm:` alias
retains both target package identity and version; governed dependency keys may
not alias another package, and governance is independently applied when an
otherwise ungoverned key aliases a governed target. URL, git, file, link,
workspace, portal, shorthand, malformed alias, and malformed suffix references
fail before snapshot lookup even when a matching hostile snapshot exists.

Every present root or snapshot dependency/optional-dependency section must be
object-valued. Every visited snapshot must be an object and must resolve to an
object-valued base package metadata record. Missing, null, array, scalar,
malformed-map, external, or unresolved nodes throw rather than truncating the
closure. Hostile fixtures cover all of those shapes, exact matching external
snapshot edges, alias substitution in both governance directions, quoted
vulnerable keys, independently vulnerable package/snapshot sections, safe data
strings and comments, and vulnerable governed edges. The production closure
contains `brace-expansion@5.0.8` and excludes dev-only
`brace-expansion@1.1.15`; explicit Next, AJV, and minimatch edges resolve to the
intended patched versions.

## Standalone native-runtime proof

`next.config.ts` uses the supported `outputFileTracingIncludes` mechanism:

```ts
outputFileTracingIncludes: {
  "/*": ["node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*"],
},
```

Completed against implementation
`5455169e5c3560101f2178617568c1795926a26f`:

- frozen install with pnpm 10.34.5: pass
- lint: pass, 282 files, no warnings
- typecheck: pass
- dependency security tests: 1 file and 9 tests passed
- all remaining branch-local tests passed with only the two known cross-PR macOS
  platform cells excluded; both pass without exclusions in the integrated proof
- machine-readable production audit: pass, zero vulnerabilities across 378
  production dependencies
- Next.js 16.2.12 production build: pass
- `git diff --check`: pass
- GitHub `verify`: success on exact source head
  `5455169e5c3560101f2178617568c1795926a26f`
- synthetic eight-PR integration commit
  `1ee96d3357a1fab01490a943abc6ed89d71c023a`, tree
  `46db3784f044be67e5292b53f72a38d23105ab7c`: frozen pnpm 10.34.5 install,
  warning-free lint on 293 files, strict TypeScript, zero production-audit
  findings across 378 dependencies, all 89 files and 2,336 tests, and the
  Next.js 16.2.12 production build passed

APR round 2 correctly rejected pnpm 10.33, raw-text lockfile assertions,
unproven production ancestry, and incomplete hostile mutations. Round 3
correctly rejected the protocol blacklist, discarded `npm:` alias identity,
and structurally incomplete production closure. The strict registry allowlist,
target-aware governance, object-valued graph validation, package metadata
requirement, and hostile matching-snapshot matrix close every source blocker.
Round 4 must review this exact regenerated patch.

## Release boundary

This source change does not authorize deployment. After every PR merges, the
exact default-branch SHA must pass managed preflight, canonical staging
deployment, Sharp/libvips and real image-optimizer proof, full application
verification, and guarded production promotion with rollback retained.
