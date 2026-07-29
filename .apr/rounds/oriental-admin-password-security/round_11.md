Decision

Do not merge this tree.

I bound the review to implementation commit 56f1dba7cd3b9dd052645b70b87c56e592e64ebe, tree 07f9c2f310628b881ec8f9ae526479c3a590c1cf, and the attached 5,165-line, 235,921-byte source-only patch. Its recomputed SHA-256 is b8259805e939bca93a702684b9aeec65b0645126d969f16babf51aec4a798a43, exactly matching the manifest.

attachments-bundle

The runtime authority design materially contains the known-password risk:

the password is treated as potentially known;

it is accepted only by the same-origin, rate-limited login;

it is neither a bearer credential nor a session-signing key;

it mints a signed method=password, role viewer, thirty-minute session;

that session is limited to dashboard.aggregate and session.logout;

raw records, email addresses, transcripts, voice detail, events, analytics/queues, and mutations remain behind managed-token step-up.

The owner still accepts disclosure and repeated observation of the permitted aggregate values. Thirty-minute expiry does not restore password secrecy or prevent repeated login, but the accepted residual risk does not extend to PII, raw data, bearer authority, signing authority, or mutation authority.

attachments-bundle

That design is not the reason for rejection. The release blocker is that the mandatory whole-program authority admission test still has reproducible false greens. The new fixtures close the exact round-ten strings, but semantically equivalent strict-TypeScript paths remain admitted.

Release-blocking findings
1. Destructured and reflected loader acquisition still bypasses the login-only authority proof

Path: tests/admin-auth-boundary.test.ts
Relevant implementation region: new-file lines approximately 3248–3459.

The repair now unconditionally rejects direct imports of node:module, including namespace, default, and import-equals forms, and it detects a direct property or element access named getBuiltinModule. It also retains direct require, module.require, loader-alias, bind/call/apply, and dynamic-import handling.

attachments-bundle(16)



attachments-bundle(16)

However, the process.getBuiltinModule check is syntactic: it rejects a property or element access whose member is literally getBuiltinModule. It does not propagate the loader identity through destructuring or reflection.

attachments-bundle(16)

I invoked the exact extracted protectedSymbolAuthority helper. Each of these strict-TypeScript fixtures returned an empty forbiddenAccesses array:

TypeScript
const { getBuiltinModule } = process as any;
const nodeModule = getBuiltinModule("module") as typeof import("node:module");
const req = nodeModule.createRequire(import.meta.url);
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
TypeScript
const getBuiltinModule = Reflect.get(process, "getBuiltinModule") as (
  name: "module",
) => typeof import("node:module");

const nodeModule = getBuiltinModule("module");
const req = nodeModule.createRequire(import.meta.url);
const auth = req("../../../../lib/server/admin-auth");

auth.verifyAdminLoginCredential("potentially-known-password");

Equivalent reflected acquisition of module.require also false-greens:

TypeScript
const req = Reflect.get(module, "require") as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);

The attached hostile suite does cover direct namespace/default/import-equals createRequire, direct process.getBuiltinModule("module"), and bind/call/apply transformations, so those exact strings now fail.

attachments-bundle(16)

 The broader claimed property does not hold.

Why this is material

A repository-local production module could acquire verifyAdminLoginCredential and createAdminLoginSession, verify the potentially known password, and mint a valid password session through a route other than POST /api/admin/login. That alternate path could omit the governed route’s same-origin and rate-limit controls.

The checker-resolved call pass is not a reliable backstop for this case because the result of reflected/CommonJS loading is effectively untyped or explicitly cast; the protected property no longer resolves to the original TypeScript declaration identity.

The whole-program source expansion itself appears comprehensive, but its loader recognizer does not fail closed under these transformations.

2. Mutation-target tracking still loses allowed exports through global aliases and late-built containers

Path: tests/admin-auth-boundary.test.ts
Relevant implementation regions: approximately lines 2351–2559 and 2893–2996.

The repair adds direct support for globalThis.Object and globalThis.Reflect. But authBuiltinReceiver accepts only:

an identifier already in the receiver-alias map; or

an immediate property or element access whose receiver is the bare identifier globalThis.

It does not follow an alias of globalThis, destructuring from globalThis, or reflective extraction of the constructor.

attachments-bundle(16)

These exact-helper fixtures returned no violations:

TypeScript
const G = globalThis;
G.Object.assign(adminCookieHeader, { signer: sign });
TypeScript
const { Object: O } = globalThis;
O.assign(adminCookieHeader, { signer: sign });
TypeScript
const O = Reflect.get(globalThis, "Object") as ObjectConstructor;
O.defineProperty(adminCookieHeader, "signer", { value: sign });

The new suite correctly rejects the direct round-ten cases—globalThis.Object.assign, bound Object.assign, nested Function.prototype.call.call, a global receiver alias followed by a bound primitive, and a primitive stored in an object.

attachments-bundle(16)

 Those fixtures do not exercise aliases of globalThis itself.

A second target-identity gap remains for containers populated after declaration:

TypeScript
const box: { target?: typeof adminCookieHeader } = {};
box.target = adminCookieHeader;

Object.assign(box.target, { signer: sign });
TypeScript
const targets: Array<typeof adminCookieHeader> = [];
targets.push(adminCookieHeader);

Object.defineProperty(targets[0], "signer", { value: sign });
TypeScript
const box: Record<string, unknown> = {};
Object.defineProperty(box, "target", { value: adminCookieHeader });

Reflect.set(box.target as object, "signer", sign);

The mutable-export alias pass follows variable initializers and plain assignments whose left side is a simple identifier. It does not make the object property or array element into an alias of adminCookieHeader when the allowed export is inserted later.

attachments-bundle(16)

A related apply path remains open when the argument vector is assembled dynamically:

TypeScript
const args: any[] = [];
args.push(adminCookieHeader, { signer: sign });

Reflect.apply(Object.assign, null, args);

The target extractor can identify the first element of an array literal, but it does not resolve the first element of a later-mutated argument-array variable. Its fallback associates the primitive with the outer call arguments rather than recovering the actual first argument passed to Object.assign.

attachments-bundle(16)

Why this is material

These forms can attach sign, verifyAdminBearerToken, the private claims WeakMap, or another protected authority to an allowed exported function object. The module’s effective export names remain unchanged, so the export-name and declaration-kind checks remain green. An external importer can then retrieve the attached private authority.

This directly defeats the intended guarantee that allowed auth exports cannot be augmented through global, bound, indirect, definition, or container-based mutation.

3. Private-authority taint still fails through prototype-mediated receiver mutation and dynamic apply vectors

Path: tests/admin-auth-boundary.test.ts
Relevant implementation region: approximately lines 2565–2891.

The new implementation correctly propagates taint through &&, ||, ??, comma expressions, and assignment expressions.

attachments-bundle(16)

 It also adds direct receiver mutation handling for:

array push, unshift, splice, fill, and copyWithin;

Map.set;

Set.add;

recognized Object/Reflect definition primitives.

The supplied fixtures now reject direct logical/comma returns, direct array mutations, direct Map.set, direct Set.add, and direct Object.defineProperty.

attachments-bundle(16)

The receiver-mutation recognizer nevertheless inspects the immediate callee member. Under prototype-mediated invocation, that member is call or apply, not push, set, or add; the actual receiver containing the private value is therefore not tainted. The method allowlist and receiver-root logic are visible here.

attachments-bundle(16)

I reproduced false greens for:

TypeScript
export function clearAdminCookieHeader() {
  const result = { values: [] as unknown[] };

  Array.prototype.push.call(result.values, sign);

  return result as unknown as string;
}
TypeScript
export function clearAdminCookieHeader() {
  const result = new Map<string, unknown>();

  Map.prototype.set.call(result, "signer", sign);

  return result as unknown as string;
}
TypeScript
export function clearAdminCookieHeader() {
  const result = new Set<unknown>();

  Set.prototype.add.apply(result, [verifyAdminBearerToken]);

  return result as unknown as string;
}

A dynamically constructed definition vector also escapes:

TypeScript
export function clearAdminCookieHeader() {
  const result: Record<string, unknown> = {};
  const args: any[] = [];

  args.push(result, "signer", sign);
  Reflect.apply(Reflect.set, null, args);

  return result as unknown as string;
}

The propagation loop taints a directly recognized mutation receiver when one of the direct arguments is tainted. Under these prototype call/apply forms, the computed receiver root is Array, Map, Set, or another method holder rather than result. For the dynamic argument vector, the args array becomes tainted, but no edge is created from the tainted argument array back to the first element that is the actual mutation target.

attachments-bundle(16)

Why this is material

An allowed exported function can return a container that has been populated with the private signer or bearer verifier. The checker reports no private-authority return, even though the caller receives the protected function through the returned array, map, set, or defined property.

This disproves the asserted closure over arrays, Maps, Sets, definition primitives, bind results, and later receiver mutations.

Prior-blocker recheck
Area	Result	Conclusion
Potentially known password authority	Pass for current runtime source	Viewer-only, signed provenance, thirty-minute expiry, aggregate plus logout only
Password bearer rejection	Pass in source and tests	Password is not among bearer candidates and never signs a session
Dedicated aggregate DTO	Pass	Fixed numeric shape; no records, transcripts, events, queues, or analytics detail
Count bound by normalized take	Pass	Every count is finite, integer, nonnegative, and at most the exact normalized take
Subset ≤ parent constraints	Pass	Lead subsets are bounded by recentLeads; voice subsets by reviewedSessions
One-time private claims	Pass in runtime code	Exact-object WeakMap lookup followed by deletion before minting
Collision cross-products	Pass	Review, ops, and privacy bearer collisions fail auth planes closed
Token/HMAC rotation	Pass	Token rotation invalidates old HMACs and both password/review cookies
Effective Next configuration	Pass for current tree	Production loadConfig output governs supported route extensions
Current route inventory and exports	Pass for current tree	No extra current route or runtime export found
Whole-program program-source expansion	Pass structurally	Repository-local program files are included
CommonJS/dynamic loader closure	Fail	Destructured and reflected loader acquisition still false-greens
Object/Reflect mutation closure	Fail	Global aliases, late target containers, and dynamic apply vectors escape
Private-authority taint closure	Fail	Prototype-mediated receiver mutations and dynamic argument arrays escape
Canonical release target validation	Pass as source mechanism	Exact canonical HTTPS root origins only
Hard-fail release E2E	Pass as source mechanism	Missing configuration, invalid report, zero expected tests, skips, flakes, or failures reject
Safe telemetry	Pass	Only actor, credential method, role, and expiry are emitted
Live runtime/deployment proof	Pending	Correctly not claimed as complete

The Convex query has an explicit fixed return object and takes no more than the normalized cap.

attachments-bundle(16)

 The independent Next-side schema uses strict objects, bounded integer counts, bounded percentages, and parent/subset refinements.

attachments-bundle(16)

The one-time mint claims remain sound in the runtime implementation: canonical claims are stored under the exact verifier-return object, fetched during mint, and deleted before validation and cookie construction.

attachments-bundle(16)

The password-rendered page branches immediately to getAdminAggregateMetrics rather than materializing the raw dashboard.

attachments-bundle(16)

 Successful-login telemetry contains only actor, credential provenance, expiry, and role.

attachments-bundle(16)

Supported safe transformations remain usable. The suite continues to admit an unrelated node:path namespace import, harmless mutation of a fresh object, and source-only object construction that merely contains an allowed export without mutating that export.

attachments-bundle(16)



attachments-bundle(16)

 The false greens above therefore are not caused by the checker simply rejecting everything.

Raw-artifact hash recomputation

The manifest declares exact sizes and hashes for the source patch and seven principal support artifacts.

attachments-bundle

 I reconstructed each embedded payload from the attached bundle and recomputed its SHA-256.

Artifact	Bytes	Recomputed SHA-256	Result
Outer attachments-bundle(16).txt	1,968,150	9de4e2e50bb04b31e370b022bff3f49381facc3953fb9ef0d633f9f9c507c6f5	Computed
Evidence manifest	20,940	4c7d0da2269238320cd1f1be2d8e461dda01ded6983f05bdf96004a065844008	Computed
Source-only patch	235,921	b8259805e939bca93a702684b9aeec65b0645126d969f16babf51aec4a798a43	Matches
Review specification	5,567	4372cab8447159533853106e6eb936346537da816f3ecdbef3c9a019a2ecf4b5	Computed
github-evidence.json	119,618	b19d105563cfd7b14ae9478498ebf73f3d97662e1e8e9d36a37921f42cd37c34	Matches
source-ci.log	71,104	edd86bcdc9ad84f244c461f5c91ab722a96e685952143fc5ab714f82b9aeea79	Matches
integration-ci.log	76,838	8c5efc9c788a9a7c794985ccb67997303e908475756daa3a3ea93ab9bcbea44d	Matches
integration-merge-dag.txt	97,426	7f3daafafe52ea403b4e85c4bcd103fc31b2723b363b5a979063aa0b879b99cf	Matches
source-to-integration-overlap.diff	34,002	61654a437f0abb79038add16e78bddbc422a5b43cc7927584c078d723c10c0ee	Matches
integration-vitest.json	865,301	058f8b776d33b03a229d250af2e67795f327f1e1dc0c6d4176bb42b088a0eef1	Matches
integration-audit.json	310	e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c	Matches
Final-head GitHub evidence	184,032	3141b2b1918c439da2050e0eb69fb8ab5177ebb33d043bb898c561d92959060d	Computed; no manifest digest declared
Final-head CI log	71,142	a59d2a8e3841987c95b3bbc2ee6b8b7201249c88258ed43fe610eebefc215c4e	Computed; no manifest digest declared
source-to-live-head.diff	71,094	ff85afe719e337fb2aa5fcb2a818e9549f63ee3c7f1fd3767c137ecb27152ebe	Computed; no manifest digest declared

integration-vitest.json has no terminal newline; its hash and byte count match the raw JSON payload without adding one. All JSON artifacts parsed successfully.

The Vitest JSON contains 89 file results, 216 suites, and 2,337 passed tests, with zero failed, pending, or todo tests. The audit JSON reports 378 production dependencies and zero findings at every severity.

Exact CI and integration evidence
Source CI

The raw GitHub evidence confirms:

run 30385889863;

event pull_request;

head SHA 56f1dba7cd3b9dd052645b70b87c56e592e64ebe;

check suite 82358314571;

completed with conclusion success.

attachments-bundle(16)

The raw job and check-run objects confirm job/check 90364964491, the same head SHA, and success.

attachments-bundle(16)



attachments-bundle(16)

The source CI log independently prints:

checkout SHA 56f1dba7cd3b9dd052645b70b87c56e592e64ebe;

tree 07f9c2f310628b881ec8f9ae526479c3a590c1cf.

attachments-bundle(16)

The source workflow uses pnpm 10.33.0; the requested 10.34.5 frozen pin belongs to the integration tree, not this source run.

Eight-head integration

The raw integration run confirms:

run 30386074734;

event pull_request;

head commit 0e0e3376bb8044015a38b83d1a71574b697fee78;

suite 82358888463;

completed successfully.

attachments-bundle(16)

The raw job/check confirms job/check 90365587296, the same integration head, and success.

attachments-bundle(16)



attachments-bundle(16)

The integration log independently prints:

checkout commit 0e0e3376bb8044015a38b83d1a71574b697fee78;

tree 13b7f4fa47989a5604bbf5e25b27ac763414ae5a;

pnpm 10.34.5.

attachments-bundle(16)

All eight requested heads are listed as ancestors:

#78 7657afae19433f276c89967ca9f6c2a94a509fd9

#79 aaeba89264b34a902d4d1595bf4d31907a91b2d4

#80 56f1dba7cd3b9dd052645b70b87c56e592e64ebe

#81 297e0b1a47d7d8cf3a005c606146b7de8dd7ff96

#82 d81140cb87ff36a6e4196f230a9b4d7bf9a69806

#83 f9467a918708c9385163516e01f34f4d9bb58d3f

#84 413fdf0eaf758394c68d817aaf588558ead80a57

#85 42bd5f078754ae925d71f7f9cc1e5eb8778a5f20

The first-parent record shows integration head 0e0e337… merging the previous eight-head integration state with exact source head 56f1dba….

attachments-bundle(16)

 The raw commit has tree 13b7f4…, first parent 217cb9e…, and second parent 56f1dba….

attachments-bundle(16)

The integration run additionally proves:

lint completed without lint findings;

strict next typegen && tsc --noEmit completed;

89 files and 2,337 tests passed;

zero audit findings across 378 production dependencies;

Next.js 16.2.12 compiled and ran strict TypeScript;

the mobile performance test passed with LCP 1,412 ms, CLS 0, 444,010 transferred JavaScript bytes, 15 initial JavaScript requests, and zero serious or critical accessibility violations.

attachments-bundle(16)



attachments-bundle(16)



attachments-bundle(16)



attachments-bundle(16)



attachments-bundle(16)

There is one secondary evidence inconsistency: the manifest says integration lint covered 295 files, while the raw integration log says Checked 294 files. The warning-free lint result is proven, but the manifest’s file-count claim is inaccurate.

attachments-bundle



attachments-bundle(16)

The integration log is not globally warning-free: pnpm setup emitted a Node deprecation notice, and Next printed ordinary cache/telemetry notices. The lint command itself was warning-free, which is the requested gate.

The source-to-integration overlap does not modify lib/server/admin-auth.ts or tests/admin-auth-boundary.test.ts; therefore, the reproduced checker defects are present unchanged in the integration tree.

Final live PR-head comparison

The attached final evidence records live PR #80 head:

commit 7934ed2d9a04b20ea7d9dd10e107033f244649c2;

tree 356c986315c97a9005b8405930e32d7c42f4cce7;

run 30386658885;

job/check 90367520889;

suite 82360630325;

event pull_request;

conclusion success.

attachments-bundle(16)



attachments-bundle(16)



attachments-bundle(16)



attachments-bundle(16)

source-to-live-head.diff contains exactly four changed paths, all under .apr/:

.apr/evidence/oriental-admin-password-security.md

.apr/evidence/oriental-admin-password-security.patch

.apr/rounds/oriental-admin-password-security/round_10.md

.apr/workflows/oriental-admin-password-security.yaml

attachments-bundle(16)

Therefore, the attached live-head evidence shows no non-APR descendant source change after implementation commit 56f1dba…. The blockers above are in the reviewed implementation tree itself; they were not introduced by the evidence-only descendant.

Mandatory post-merge gates remain incomplete

None of the following may be described as already proven by this source review:

deriving the reaffirmed password HMAC without logging either input;

writing it to both governed Infisical scopes;

reconciling and reading back the complete managed Coolify environment;

performing the Convex-first release sequence;

deploying the exact corrected merge SHA to canonical staging;

proving live HttpOnly, SameSite, and production Secure cookie flags;

proving signed method=password, role viewer, and thirty-minute expiry;

proving password bearer rejection;

proving configured review-token role and twelve-hour expiry;

proving raw review, lead, transcript/voice, events, analytics/queue, and mutation routes return 403 to the password session;

proving Redis store identity, shared remaining counts, and exhaustion to 429;

promoting the identical SHA and completing guarded same-SHA production verification and rollback proof.

The evidence manifest correctly labels the managed readback, exact-SHA staging, clean-cookie release proof, live cookie and authority claims, and identical-SHA production verification as post-merge work.

attachments-bundle

A corrected candidate must close the reproduced destructured/reflected loader paths, global and late-container mutation aliases, prototype call/apply receiver mutations, and dynamic apply-vector data flow; add those exact fixtures; and regenerate source, integration, raw-artifact, and final-head evidence for the new tree.

VERDICT: DO NOT MERGE
