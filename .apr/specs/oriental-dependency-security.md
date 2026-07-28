# Oriental production dependency security contract

## Objective

Eliminate every known high-severity production dependency advisory without
weakening CI, production builds, Next.js standalone runtime behavior, or image
optimization.

## Required behavior

1. The explicitly pinned pnpm version must run
   `pnpm audit --prod --audit-level=high --json` successfully from the frozen
   lockfile against a recorded registry, with machine-readable zero-high output.
2. CI must record pnpm version and registry, then execute the production audit
   before lint, typecheck, tests, and build.
3. Next.js and `eslint-config-next` must use the same patched release.
4. Patched transitive versions must use vulnerable-resolution or
   vulnerable-range scoped overrides and be lockfile-enforced.
5. Tests must inspect the frozen package/snapshot graph and reject every
   governed vulnerable resolution, not merely inspect manifest strings.
6. The standalone output must contain Sharp's native runtime and libvips assets.
7. The production standalone server must load Sharp and serve an optimized
   image, not merely compile successfully.
8. The existing full test, lint, type, build, and performance gates remain
   mandatory.

## Acceptance evidence

- Exact implementation SHA and complete patch are recorded.
- Production audit reports no known vulnerabilities.
- Dependency resolution proves the governed patched versions.
- Biome, strict TypeScript, focused security tests, and production build pass.
- The built standalone server loads Sharp with libvips and returns an optimized
  JPEG with HTTP 200.
- GitHub CI passes on the final exact PR head.
- Hermetic APR returns an explicit merge verdict.
