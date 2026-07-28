# Oriental production dependency security contract

## Objective

Eliminate every known high-severity production dependency advisory without
weakening CI, production builds, Next.js standalone runtime behavior, or image
optimization.

## Required behavior

1. `pnpm audit --prod --audit-level=high` must pass from the frozen lockfile.
2. CI must execute the production audit before lint, typecheck, tests, and build.
3. Next.js and `eslint-config-next` must use the same patched release.
4. Patched transitive versions must be explicit and lockfile-enforced.
5. The standalone output must contain Sharp's native runtime and libvips assets.
6. The production standalone server must load Sharp and serve an optimized
   image, not merely compile successfully.
7. The existing full test, lint, type, build, and performance gates remain
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
