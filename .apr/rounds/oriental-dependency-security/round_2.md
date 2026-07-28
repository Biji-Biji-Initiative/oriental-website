## Review result

The earlier **pnpm audit-endpoint concern is rebutted** by the supplied live-run evidence: run `30338953872` installed pnpm `10.33.0`, reached the audit service, completed the production audit, and finished the Linux job successfully. The new source also records `pnpm --version` and `pnpm config get registry` immediately before invoking the JSON audit. That establishes endpoint operability.

It does **not**, however, make this exact tree admissible. There are two source-level blockers and one mandatory-evidence blocker. A further production-reachability question remains unresolved.

## Blocking findings

### 1. The tree pins a package-manager version with known high-severity install-time vulnerabilities

The implementation deliberately pins pnpm `10.33.0` in `package.json` and CI:

* `.apr/evidence/oriental-dependency-security.patch:41`
* `.apr/evidence/oriental-dependency-security.patch:1736-1742`
* `.apr/evidence/oriental-dependency-security.md:31-32,47-55`

That version is below the patched pnpm `10.34.0` boundary for at least two high-severity install-time vulnerabilities:

* A malicious transitive dependency alias can escape `node_modules` and replace project paths such as `tests/`, scripts, local GitHub Actions, or `node_modules/.bin`; the substituted payload then runs during ordinary later commands such as tests or builds.
* A malicious pnpm patch can traverse outside the package directory and write or delete arbitrary files accessible to the user running `pnpm install`.

Both advisories mark pnpm versions below `10.34.0` as affected. The `10.34.0` release rejects out-of-tree patch paths and dependency aliases containing path-traversal segments. ([GitHub][1])

This maps directly onto the workflow ordering at `.apr/evidence/oriental-dependency-security.patch:8-16`: the vulnerable pnpm runs `install` before lint, typechecking, tests, and build-related gates. Those later gates therefore cannot be treated as authoritative if the installer itself can rewrite their inputs.

The zero-result production audit does not contradict this finding. `pnpm audit --prod` audits the project’s installed production packages; the globally installed pnpm executable is not part of that production dependency graph. The official pnpm documentation confirms that `--prod` limits the audit to production dependencies. ([pnpm][2])

**Required correction:** pin an exact reviewed pnpm version in the patched `>=10.34.0 <11` range in both `packageManager` and `pnpm/action-setup`, update the test expectation, and rerun the complete exact-head Linux workflow. Given the evidence contract, merely allowing an unpinned “latest” version would not be an acceptable replacement.

### 2. The lockfile security test has concrete false-green paths

The test at `.apr/evidence/oriental-dependency-security.patch:1709-1733` does not actually parse the lockfile’s package and snapshot mappings. It slices raw text and searches for selected strings.

The most direct failure is PostCSS:

* The override governs `postcss@<8.5.18` at patch lines `46` and `92`.
* The test rejects only `8.4.31` and `8.5.15` at patch lines `1728-1729`.
* A coherent lockfile containing both the required `postcss@8.5.23` and a vulnerable `postcss@8.5.17` resolution would satisfy every current assertion.

That is not hypothetical range interpretation: the reviewed PostCSS advisory marks every version through `8.5.17` as affected and `8.5.18` as the patched boundary. ([GitHub][3])

The text-based implementation also permits representation-level bypasses:

* A semantically valid quoted YAML key such as `'postcss@8.5.15':` is not matched by the regular expression, which expects exactly two spaces followed immediately by the unquoted key.
* The positive `toContain` assertions can be satisfied by comments containing strings such as `postcss@8.5.23:`, without proving that those keys are effective package resolutions.
* The test does not normalize snapshot keys with peer suffixes or prove that package and snapshot sections agree.

Consequently, the evidence statement that the test “reads the actual lockfile package/snapshot sections” is stronger than the implementation supports. This violates `.apr/specs/oriental-dependency-security.md:19-20`, which expressly requires the test to reject **every** governed vulnerable resolution rather than inspect manifest strings.

**Required correction:** parse `pnpm-lock.yaml` as YAML, extract and normalize the effective keys from both `packages` and `snapshots`, and evaluate versions against the governed selectors. At minimum, hostile mutation tests must cover:

* `postcss@8.5.17`;
* a quoted vulnerable key;
* a safe-version string appearing only in a comment;
* vulnerable package and snapshot representations independently.

The same parsed test should verify that every snapshot dependency edge points at the intended patched resolution, not merely that a patched package key exists somewhere in the file.

### 3. Coverage of every vulnerable production edge is not yet proven

For the four specifically identified production edges, the source changes are technically coherent:

* `brace-expansion 5.0.7 → 5.0.8`;
* `fast-uri 3.1.3 → 3.1.4`;
* PostCSS versions below `8.5.18 → 8.5.23`;
* `sharp 0.34.5 → 0.35.3`.

The patched targets match the reviewed advisory boundaries: `fast-uri` `3.1.4`, Sharp `0.35.0+`, PostCSS `8.5.18+`, and `brace-expansion` `5.0.8` are patched releases. ([GitHub][4])

However, the lockfile visibly retains `brace-expansion@1.1.15` at `.apr/evidence/oriental-dependency-security.patch:508-509`. The current advisory’s affected range is `<=5.0.7`, so `1.1.15` is also an affected release. ([GitHub][5])

Its mere lockfile presence does **not** prove a production defect because pnpm’s lockfile combines production and development reachability. The supplied local `--prod` audit returning zero is positive evidence that this older resolution may be development-only. But the source test does not establish that fact, and the mandatory final exact-head production audit has not yet run.

Therefore, the requested statement that the overrides cover **every vulnerable production edge** cannot yet be confirmed. The final evidence needs either:

* a machine-readable exact-head production ancestry proving that `brace-expansion@1.1.15` has no production path; or
* removal or remediation of that affected resolution if a production path exists.

The same production-ancestry proof should be retained for all exact-resolution overrides, because an exact override such as `sharp@0.34.5` cannot by itself prove that no second affected Sharp version exists elsewhere in the production graph.

### 4. Final exact-head Linux CI is still absent

The evidence manifest itself states that final exact-head CI “remains mandatory” and will repeat the pinned toolchain, registry record, JSON audit, tests, build, and performance job at `.apr/evidence/oriental-dependency-security.md:80-81`.

The cited GitHub run is useful but insufficient for admission:

* It is associated with evidence head `0430de2253d6185f620028e705b2a5bd99c3926e`, not identified as the final exact PR head.
* The manifest describes that run’s audit as `pnpm audit --prod --audit-level=high` with the human-readable “No known vulnerabilities found” result.
* It separately describes the current JSON form as having been run locally at `.apr/evidence/oriental-dependency-security.md:58-77`.

Thus the cited run proves that pnpm `10.33.0` could reach and complete the audit endpoint; it does not prove the newly changed version/registry logging and JSON command on the final exact head. Local execution cannot substitute for the GitHub acceptance gate required by `.apr/specs/oriental-dependency-security.md:35`.

After correcting the pnpm pin and lockfile test, the final exact-head Linux run must demonstrate, in one source-identified run:

1. frozen install with the corrected exact pnpm version;
2. recorded exact version and expected registry;
3. `pnpm audit --prod --audit-level=high --json` returning zero high and critical vulnerabilities;
4. the corrected hostile dependency-security tests;
5. complete lint, typechecking, full tests, production build, and Linux performance checks.

## Controls that are otherwise confirmed

### Audit command and endpoint reconciliation

The changed workflow records:

```text
pnpm --version
pnpm config get registry
```

and then invokes the exact package script:

```text
pnpm audit --prod --audit-level=high --json
```

at `.apr/evidence/oriental-dependency-security.patch:9-13,54`.

Those flags have the claimed meanings: `--json` emits JSON, `--prod` limits the graph to production dependencies, and `--audit-level=high` filters at the high threshold. pnpm fixed JSON audit-level filtering before version `10.33.0`, so the selected version contains that behavior even though it must now be upgraded for the independent installer vulnerabilities. ([pnpm][2])

The registry command is observational rather than fail-closed: it records whatever effective registry is configured but does not assert `https://registry.npmjs.org/`. That satisfies the specification’s literal “recorded registry” wording, but the final reviewer must inspect and accept the exact logged value. A different or unexpected registry must not be treated as equivalent evidence merely because the command printed it.

### Current governed lock resolutions

Within the supplied patch, the intended governed resolutions are internally consistent:

* `minimatch@10.2.5` points to `brace-expansion@5.0.8` at patch lines `1382-1385`;
* `ajv@8.20.0` points to `fast-uri@3.1.4` at lines `1163-1168`;
* Next, Tailwind/Shadcn, and Vite-related edges shown in the patch point to PostCSS `8.5.23`;
* Next points to Sharp `0.35.3` at lines `1411-1449`.

The previously governed exact resolutions `5.0.7`, `3.1.3`, `8.4.31`/`8.5.15`, and `0.34.5` are removed from the shown package and snapshot changes. The defect is the verifier’s incomplete enforcement and the unresolved older brace-expansion ancestry, not the four intended target versions.

### Next.js package alignment

Alignment is correct in the supplied tree:

* `next`: `16.2.12` in `package.json` and the importer;
* `eslint-config-next`: `16.2.12` in `package.json`, package metadata, and snapshots;
* `@next/eslint-plugin-next`: `16.2.12`;
* `@next/env` and all shown platform SWC packages: `16.2.12`.

See `.apr/evidence/oriental-dependency-security.patch:62-72,109-130,391-467,1044-1082,1252-1257,1411-1442`.

There is no Next/eslint version skew in this candidate. The focused security test does not itself assert this alignment, but the exact source and lockfile do.

### Sharp and libvips standalone tracing

The tracing rule is structurally appropriate:

```ts
outputFileTracingIncludes: {
  "/*": ["node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*"],
},
```

Next documents `/*` as a global tracing-inclusion key. ([Next.js][6])

The path pattern covers the pnpm virtual-store directories for both classes required by Sharp:

* platform native bindings such as `@img/sharp-linux-x64`;
* libvips payloads such as `@img/sharp-libvips-linux-x64`.

It also covers the corresponding musl and non-x64 variants present in the frozen lockfile. The lockfile’s Sharp snapshot links `sharp@0.35.3` to the `0.35.3` native packages and `1.3.2` libvips packages at `.apr/evidence/oriental-dependency-security.patch:1496-1553`.

The reported standalone load of `sharp=0.35.3` and `vips=8.18.3` is exactly the combination recommended by the Sharp advisory, and the evidence says the native binding and libvips assets were found in the standalone output. ([GitHub][7])

That is adequate **source and local standalone evidence**. It is not deployment proof.

## Non-waivable release boundary

Even after source correction and exact-head CI success, this review must not authorize production deployment.

Canonical staging must deploy the exact default-branch SHA and prove on the actual image architecture and libc that:

* Sharp loads as `0.35.3`;
* libvips reports `8.18.3`;
* the expected native binding and libvips assets exist in the deployed standalone filesystem;
* a real `/_next/image` request with an actual width/quality transformation returns HTTP `200`;
* the response has the expected image content type, a nonempty decodable body, and no Sharp-missing or native-loader error;
* the running image and application revision are tied to the exact promoted SHA.

Guarded production promotion must retain rollback and repeat the relevant image-optimizer and application verification. Neither the earlier local HTTP `200` nor a successful Linux build can replace those staging and production checks, particularly where CI and the production container may differ between glibc and musl or in optional-package pruning.

The endpoint concern is closed, the Next/ESLint alignment is correct, and the Sharp tracing design is sound. The vulnerable pnpm pin, false-green lockfile verifier, unresolved complete production-edge proof, and absent final exact-head CI prevent admission.

VERDICT: DO NOT MERGE

[1]: https://github.com/pnpm/pnpm/security/advisories/GHSA-hwx4-2j3j-g496 "https://github.com/pnpm/pnpm/security/advisories/GHSA-hwx4-2j3j-g496"
[2]: https://pnpm.io/10.x/cli/audit "https://pnpm.io/10.x/cli/audit"
[3]: https://github.com/advisories/GHSA-r28c-9q8g-f849 "https://github.com/advisories/GHSA-r28c-9q8g-f849"
[4]: https://github.com/advisories/GHSA-v2hh-gcrm-f6hx "https://github.com/advisories/GHSA-v2hh-gcrm-f6hx"
[5]: https://github.com/advisories/GHSA-mh99-v99m-4gvg "https://github.com/advisories/GHSA-mh99-v99m-4gvg"
[6]: https://nextjs.org/docs/pages/api-reference/config/next-config-js/output "https://nextjs.org/docs/pages/api-reference/config/next-config-js/output"
[7]: https://github.com/advisories/GHSA-f88m-g3jw-g9cj "https://github.com/advisories/GHSA-f88m-g3jw-g9cj"

