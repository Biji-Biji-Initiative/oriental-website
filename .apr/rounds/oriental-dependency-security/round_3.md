# Oracle Browser Transcript

Conversation: https://chatgpt.com/c/6a689088-9804-83ed-96ec-daffe2b825b8

## Prompt

Perform an adversarial exact-tree security and runtime review of Oriental
dependency implementation commit
eb1e12969ee3f130939772b6e76ae8cda618dd25. Use the source-only patch and
evidence manifest. Verify the exact pnpm 10.34.5 pin, explicit registry/version
logging, and machine-readable production audit. Confirm the effective lockfile
is parsed as YAML, governed constraints are evaluated with semver, packages and
snapshots are independently checked, every governed dependency edge is safe,
and the complete production closure starts from importer production and
optional dependencies while failing closed on unresolved or external edges.
Recheck hostile comment, inert-string, quoted-key, independently vulnerable
package/snapshot, and vulnerable-edge mutations. Prove production contains
patched brace-expansion 5.0.8 while excluding dev-only 1.1.15, Next.js and
eslint-config-next remain aligned, and Sharp native/libvips tracing is complete.
Confirm exact-source-head Linux CI and integration commit
76746d98e6a7b220c3abaf4a93dd426236fc2b2b, tree
058805ee5d6860b760b14657d3ede08735111a91, with 89 files and 2,303 tests.
Do not waive final staging image-optimizer or production proof. End with
`VERDICT: MERGE` or `VERDICT: DO NOT MERGE` on its own final line.

## Answer

## Release-blocking findings

### 1. External production edges are not fail closed

`resolveSnapshotKey` rejects only references beginning with `file:`, `link:`, or `workspace:`:

`.apr/evidence/oriental-dependency-security.patch:2009-2017`

Every other reference is converted into a candidate snapshot key and accepted whenever that key exists. For example, this path succeeds:

```yaml
importers:
  .:
    dependencies:
      remote:
        version: "https://example.invalid/remote.tgz"
packages:
  "remote@https://example.invalid/remote.tgz": {}
snapshots:
  "remote@https://example.invalid/remote.tgz": {}
```

The execution is:

1. `https:` does not match the three-scheme blacklist.
2. The candidate becomes `remote@https://example.invalid/remote.tgz`.
3. The matching snapshot exists, so the edge is accepted.
4. `governedProductionProblems` sees the ungoverned package name `remote` and reports nothing.

The same design can admit other URL-, git-, portal-, or otherwise opaque references, including malformed targets wrapped in `npm:`. This directly contradicts the requested guarantee that **all external production edges fail closed**.

The resolver needs an allowlist, not a protocol blacklist. It should accept only:

* A concrete registry package reference with a valid semantic version, allowing the normal peer or patch suffix.
* A well-formed `npm:<target-name>@<semantic-version>` alias whose target identity and version are both parsed and validated.

Every other reference form must fail before snapshot lookup. Hostile tests must include an external reference with a matching snapshot, because testing only a missing external snapshot would exercise the existing unresolved-edge failure rather than this bypass.

### 2. `npm:` alias handling discards the target package identity

For an `npm:` reference, `dependencyVersion` parses the target but returns only its version:

`.apr/evidence/oriental-dependency-security.patch:1967-1972`

The edge checker then applies governance using the dependency-map key rather than the parsed target name:

`.apr/evidence/oriental-dependency-security.patch:1974-1990`

Consequently, an edge such as:

```yaml
postcss: npm:substitute-package@8.5.23
```

is evaluated as a safe `postcss@8.5.23` edge even though it resolves to `substitute-package`. The production walker then deliberately follows `substitute-package@8.5.23`, because `resolveSnapshotKey` strips the `npm:` prefix at lines 2013-2017.

This mutation can evade the current suite by changing one of the production PostCSS edges other than the specifically asserted Next.js edge, while leaving the real `postcss@8.5.23` reachable through Next.js. The patched-presence assertion at lines 1848-1850 still succeeds, and the exact Next edge at lines 1856-1859 remains unchanged.

The inverse case is also incomplete: an ungoverned alias key pointing to `npm:postcss@8.5.17` is not recognized by `governedSnapshotEdgeProblems` as a governed target. A matching vulnerable snapshot would be caught elsewhere, but the claimed independent edge audit is still false-open.

The edge parser must retain `{targetName, targetVersion}`. A governed dependency key must not be permitted to alias a different package, and governance must also be applied when the alias target—not merely the map key—is governed.

### 3. The production closure treats malformed or incomplete graph nodes as resolved

The closure is not structurally fail closed:

* `dependencyMaps` silently returns no edges for a non-object snapshot and silently drops a present but non-object `dependencies` or `optionalDependencies` field at lines 1960-1965.
* Root production sections are similarly filtered rather than validated at lines 2023-2025.
* `resolveSnapshotKey` checks only that the snapshot key is present, not that its value is an object, at lines 2014-2017.
* `collectProductionSnapshotKeys` does not use `packages` at all, so a visited snapshot need not have corresponding package metadata or resolution information; see lines 2020-2022 and 2035-2050.

Therefore all of these are accepted rather than rejected:

```yaml
# A present but null snapshot
snapshots:
  app@1.0.0:
```

```yaml
# A reachable snapshot with a silently ignored edge map
snapshots:
  app@1.0.0:
    dependencies: "not an object"
```

```yaml
# A snapshot with no corresponding package record
packages: {}
snapshots:
  app@1.0.0: {}
```

A total loss of the root graph would happen to trip the later patched-package presence assertions, but a malformed side branch can be truncated while all four governed patched packages remain reachable elsewhere. Deleting a package record while retaining its snapshot and safe edges also passes every dependency-security assertion.

For a complete closure, any present dependency section must be object-valued, every visited snapshot must be object-valued, and every registry snapshot must resolve to appropriate package metadata. Missing, null, array-valued, scalar-valued, or externally resolved graph nodes must throw.

The hostile suite at lines 1823-1841 correctly exercises comments, inert strings, quoted keys, independent package/snapshot vulnerabilities, and one vulnerable edge. It does not exercise external references with matching snapshots, alias target substitution, null snapshots, malformed dependency maps, or missing package metadata.

## Correctly closed items

The previous pnpm blocker is closed. Both the CI setup and `packageManager` pin are exactly `10.34.5`; CI logs the actual pnpm version and effective registry immediately before running the exact machine-readable command `pnpm audit --prod --audit-level=high --json` (`ci.yml` patch lines 5-23 and `package.json` lines 45-64).

The raw-text lockfile blocker is also closed. The helper parses the effective lockfile with `yaml` 2.9.0 and evaluates governed versions with `semver` 7.8.5 (`dependency-lock-audit.ts` lines 1884-1906 and 1918-1925). Package and snapshot keys are checked independently, and canonical dependency and optional-dependency maps are examined.

For the supplied valid lockfile, the governed resolutions shown are patched:

* `brace-expansion@5.0.8`, with `minimatch@10.2.5` pointing to `5.0.8`.
* `fast-uri@3.1.4`, with `ajv@8.20.0` pointing to `3.1.4`.
* `postcss@8.5.23`, including the Next.js production edge.
* `sharp@0.35.3`, including the Next.js production edge.

The previous production-ancestry blocker is closed for the exact shown graph: the test requires `brace-expansion@5.0.8` in the production closure and excludes the exact dev-only `brace-expansion@1.1.15` snapshot (`dependency-security.test.ts` lines 1843-1850). The walker starts from root `dependencies` and `optionalDependencies` and follows both categories transitively. That current-tree result does not cure the structural and external-edge fail-open paths above.

Next.js and its lint stack are aligned at `16.2.12`: `next`, `eslint-config-next`, `@next/eslint-plugin-next`, `@next/env`, and the platform SWC packages all move together in the lockfile.

The Sharp source configuration is directionally correct. The tracing glob:

```text
node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*
```

matches both platform-addon packages such as `@img/sharp-linux-x64` and libvips packages such as `@img/sharp-libvips-linux-x64`. The lockfile contains Sharp platform packages at `0.35.3` and libvips packages at `1.3.2`. This is source-level tracing configuration, not proof that the deployed standalone image actually copied and loaded those files.

The evidence manifest records successful exact-source-head Linux verification for `eb1e12969ee3f130939772b6e76ae8cda618dd25`, and records synthetic integration commit `76746d98e6a7b220c3abaf4a93dd426236fc2b2b`, tree `058805ee5d6860b760b14657d3ede08735111a91`, with 89 files and 2,303 tests. Because repairing the blockers changes the source SHA and integration tree, both exact-head CI and combined-tree admission must be repeated on the repaired candidate.

Final staging remains a separate mandatory runtime plane: the standalone server must load Sharp/libvips and return an actually optimized image with HTTP 200. Guarded production promotion of the same admitted source, with rollback retained, also remains mandatory and is not established by the source patch or build success.

VERDICT: DO NOT MERGE
