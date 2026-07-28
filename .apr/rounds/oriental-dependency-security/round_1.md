## Release-blocking findings

### 1. BLOCKER — the production audit is not reproducible from the committed toolchain

`package.json:52` pins `pnpm@10.33.0`, while `package.json:65` and `.github/workflows/ci.yml:20-27` execute:

```text
pnpm audit --prod --audit-level=high
```

That pnpm version uses npm’s retired legacy audit endpoints. The pnpm project has a reproduction specifically for **10.33.0**, where both endpoints return HTTP 410; pnpm 11 moved `audit` to the bulk-advisories endpoint because the legacy endpoints were retired. The official setup action also documents that, absent an explicit version input, it installs the version recorded by `packageManager`. ([GitHub][1])

Therefore the manifest’s claim at `.apr/evidence/oriental-dependency-security.md:81-82` that `pnpm audit:prod` passed cannot be attributed reproducibly to the immutable toolchain. It was presumably run with an unrecorded different pnpm binary, a nonstandard registry, or both. No `pnpm --version`, registry identity, raw audit output, or audit artifact is supplied to resolve the contradiction.

The workflow step is correctly unconditional and fail-closed within the job: there is no `if`, `continue-on-error`, or `--ignore-registry-errors`. But an audit that predictably terminates on an obsolete endpoint is not a passing security audit. It means:

* the universal claim that the full production graph has no high advisories is unproved;
* the newly required CI job cannot become green under the recorded package-manager identity;
* the string-only test at `tests/dependency-security.test.ts:1729-1732` gives false confidence because it does not execute the auditor or assert its version.

Before reconsideration, the tree needs an explicitly pinned audit-capable pnpm 11.x path that demonstrably consumes this exact frozen lockfile. If the whole project migrates to pnpm 11, the overrides must also move to `pnpm-workspace.yaml`, because pnpm 11 no longer reads the `pnpm` field from `package.json`; simply changing `packageManager` would silently discard the four overrides. ([pnpm][2])

The resulting evidence must record the exact pnpm version, registry, command, exit status, and machine-readable report.

### 2. BLOCKER — the mandatory exact-head full CI result is absent

The evidence explicitly says the local performance execution failed with `ENOEXEC` and that Linux GitHub CI remains authoritative (`oriental-dependency-security.md:93-95`). It does not provide a successful full CI run for the final exact PR head.

The synthetic PR 78–85 integration result at lines 97–99 is not a substitute. It is neither identified as commit `48fd87305ca6a188ad3577c4ac24f38a140800cd` nor as the final remote PR head after any evidence-only child commits.

The contract requires the final exact head to pass:

* frozen installation;
* the functioning production audit;
* lint;
* typecheck;
* the complete Vitest suite;
* production build;
* Linux performance checks.

That requirement appears both in the evidence at lines 24–26 and in the specification at lines 18–19 and 29. It cannot be waived, and blocker 1 currently prevents such a run from succeeding.

## Dependency-graph assessment

The **named advisory set** is correctly removed from the frozen lockfile:

* Next.js is `16.2.12`, above the `16.2.11` patched boundary for the July 2026 high-severity Next.js advisories.
* Sharp is `0.35.3`; versions below `0.35.0` are affected by the libvips advisories, and `0.35.3` carries libvips `8.18.3`.
* PostCSS is `8.5.23`, above its `8.5.12` patched boundary.
* fast-uri is `3.1.4`, above both v3 high-severity fixes at `3.1.1` and `3.1.2`.
* brace-expansion is `5.0.8`, the patched version for the high-severity issue affecting `5.0.7` and earlier. ([GitHub][3])

The corresponding old resolutions are replaced in the supplied lockfile diff. Next.js and `eslint-config-next` are also consistently aligned at `16.2.12` in both the importer and package/snapshot sections, with `@next/eslint-plugin-next` likewise at `16.2.12`. That portion passes review.

I cannot confirm the broader statement that **every** high-severity production advisory is absent. The patch also removes prior overrides for `hono`, `js-yaml`, `undici`, `vite`, and `ws`; the current frozen resolutions may remain safe, but the only intended whole-graph oracle is the production audit, and that oracle is not reproducible under the committed toolchain.

## Override precision and maintainability

The overrides are deterministic and lockfile-enforced, but they are not uniformly precise:

* `"brace-expansion@5.0.7": "5.0.8"` is properly limited to the exact vulnerable resolution.
* `"fast-uri": "3.1.4"`, `"postcss": "8.5.23"`, and `"sharp": "0.35.3"` are graph-wide overrides. They would also replace a future consumer requiring a different major or, in Sharp’s case, an incompatible `0.x` API line.

There is no demonstrated conflict in this frozen graph: each currently converges on the intended patched resolution, and the build reportedly succeeds. This is therefore not an independent exact-tree runtime blocker, but it does not satisfy the strongest reading of “precise and maintainable.” During the required pnpm remediation, these should be represented in `pnpm-workspace.yaml` with vulnerable-range or parent-edge scoping where possible.

The regression test at `tests/dependency-security.test.ts:1720-1727` checks only the manifest strings. It does not inspect the resolved lockfile or prove that no vulnerable resolution remains. A durable test should additionally inspect the frozen graph and reject any production path resolving the governed vulnerable ranges.

## Sharp standalone and image-runtime assessment

The source mechanism is technically sound. `next.config.ts:39-41` uses the supported `outputFileTracingIncludes` facility with a global route selector, and its glob covers both physical pnpm package families:

* `@img/sharp-<platform>` for the native addon;
* `@img/sharp-libvips-<platform>` for the bundled dynamic libraries.

The lockfile includes the matching Sharp `0.35.3` platform packages and libvips `1.3.2` packages. Next.js documents both global tracing includes and the requirement for Sharp when using standalone production image optimization. ([Next.js][4])

The reported runtime sequence is also the right proof shape:

1. load Sharp from the standalone output;
2. observe `sharp=0.35.3` and `vips=8.18.3`;
3. start the standalone server;
4. request a real JPEG through `/_next/image`;
5. require HTTP 200 and an image response.

That directly exercises the failure class described in the manifest: package metadata being traced while the libvips dynamic library is absent. A compile-only or health-only probe would not have been sufficient.

However, the committed test at `tests/dependency-security.test.ts:1734-1736` merely checks that the glob text exists. It does not inspect `.next/standalone`, load Sharp, start `server.js`, or request the optimizer endpoint. The manifest also does not identify the tested artifact as the production Linux container image or provide commands/logs tying the result to its digest. Thus the evidence proves the tested local standalone artifact, not the eventual deployed runtime.

That distinction does not require pre-merge staging deployment, but it preserves the mandatory release gates:

* after merge, managed preflight must operate on the exact default-branch SHA;
* canonical staging must deploy the exact resulting image and repeat the Sharp/libvips and real-image optimizer probe;
* production promotion must use the same verified provenance and repeat the external image-endpoint check;
* rollback must remain available;
* no production release is authorized by a local standalone result or by a successful build alone.

## Conclusion

The dependency choices, Next/ESLint alignment, Sharp tracing configuration, and shape of the local optimizer probe are substantially correct. The implementation nevertheless cannot merge because its required security oracle is incompatible with the committed pnpm version, the claimed audit success is not reproducible, and the final exact-head full CI gate has not passed.

VERDICT: DO NOT MERGE

[1]: https://github.com/pnpm/pnpm/issues/11265 "`pnpm audit` fails with 410: npm registry has retired legacy audit endpoints · Issue #11265 · pnpm/pnpm · GitHub"
[2]: https://pnpm.io/blog/releases/11.0 "pnpm 11.0 | pnpm"
[3]: https://github.com/vercel/next.js/security/advisories/GHSA-p9j2-gv94-2wf4 "Server-Side Request Forgery in rewrites via attacker-controlled destination hostname · Advisory · vercel/next.js · GitHub"
[4]: https://nextjs.org/docs/pages/api-reference/config/next-config-js/output?utm_source=chatgpt.com "next.config.js Options: output"
