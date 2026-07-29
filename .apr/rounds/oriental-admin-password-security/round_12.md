Decision

Do not merge this tree. I verified the reviewed identity as commit 71f6d0c11eaa9c9885fb0183528b96daf7f5f7b4, tree e765a147b2dd9cd3a7ca5c6144ffb6750a7834a2, and the source-only patch hash and inventory match the manifest. 

attachments-bundle

The runtime least-privilege design does materially contain the known-password risk relative to the prior broad dashboard: the password is not a bearer or signing key; it produces a signed method=password, role viewer, thirty-minute session; and that principal is limited to the fixed aggregate DTO and logout. Customer records, email addresses, transcripts, voice detail, events, analytics/queues, and mutations remain behind managed-token step-up. The thirty-minute TTL does not restore password secrecy or stop a holder from logging in again; containment rests on the reduced authority and bounded aggregate service. That residual aggregate-inference and bounded-compute exposure is explicitly accepted. 

attachments-bundle

However, the mandatory whole-program authority-admission proof remains unsound. I independently reproduced new false greens in the same semantic classes as round eleven. These can bypass login-only verifier/minter authority or expose the private signer/bearer verifier through an allowed export. The contract expressly requires alternative module acquisition, mutable aliases, CommonJS access, and private signer/bearer-verifier escape to fail. 

attachments-bundle(17)

Release-blocking findings
1. Destructured and reflected loader identity still has false greens

Using the exact protectedSymbolAuthority implementation extracted from tests/admin-auth-boundary.test.ts, both of these returned an empty forbiddenAccesses array:

TypeScript
const { getBuiltinModule } = globalThis.process as any;
const nodeModule = getBuiltinModule("module");
const req = nodeModule.createRequire(import.meta.url);
const auth = req("../../../../lib/server/admin-auth");
auth.createAdminLoginSession({} as never, 0);
TypeScript
const modules = [module];
const M = modules[0]!;
const req = Reflect.get(M, "require").bind(M) as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");
auth.createAdminLoginSession({} as never, 0);

I executed the equivalent JavaScript on Node 22.16.0; the first acquired node:module and the second successfully loaded a local module through module.require.

The cause is structural. At tests/admin-auth-boundary.test.ts:1531-1558, destructured privileged members are recognized only when the binding initializer itself is an identifier already in an alias set. Direct globalThis.process, reflected process values, and a module identity recovered from a container are not propagated. Assignment aliasing is similarly restricted to an identifier on the left and a directly recognized right-hand value. 

attachments-bundle(17)

Impact: a production source can dynamically acquire the auth module without being counted as an import or checker-resolved call. It can then invoke the public credential verifier/minter outside POST /api/admin/login, bypassing the login route’s same-origin and rate-limit boundary. If it reads the managed review token from server configuration, it can mint a review session rather than merely a password-viewer session.

2. Global receiver and late-container identity propagation remains incomplete

These exact additions to a valid auth source both produced an empty authRuntimeExportViolations result and successfully augmented adminCookieHeader at runtime:

TypeScript
const { Object: { assign: mutate } } = globalThis;
mutate(adminCookieHeader, { signer: sign });
TypeScript
const box: any = {};
box.target ??= adminCookieHeader;
Object.assign(box.target, { signer: sign });

An assignment-destructuring variant also passes:

TypeScript
let O: ObjectConstructor;
({ Object: O } = globalThis);
O.assign(adminCookieHeader, { signer: sign });

The global receiver analysis processes only top-level binding elements whose destination is a simple identifier; nested binding patterns are skipped. 

attachments-bundle(17)

 The mutable-export graph also propagates later insertion only for plain = assignments, while the final mutation detector accepts every assignment operator only after the receiver root has already been marked. Thus ??=, ||=, and equivalent compound insertion forms leave the container untainted. 

attachments-bundle(17)

The tree’s new fixtures correctly catch the simpler top-level { Object: O }, plain box.target = adminCookieHeader, targets.push(adminCookieHeader), and args.push(...) forms. 

attachments-bundle(17)

 They do not close the equivalent nested or compound-assignment paths.

Impact: an allowed auth export can be augmented with sign, verifyAdminBearerToken, or verifiedAdminLoginClaims while the checker reports the export surface as safe. An importer can then recover authority that is supposed to remain module-private.

3. Actual receiver taint is still lost through double-call/bind prototype mutation and non-push dynamic vectors

All of the following returned no violation from the exact checker, while their JavaScript equivalents inserted the protected value into the returned object:

TypeScript
const result = { values: [] as unknown[] };
Function.prototype.call.call(Array.prototype.push, result.values, sign);
return result as unknown as string;

Equivalent Map.prototype.set and Set.prototype.add double-call forms pass, as does:

TypeScript
Array.prototype.push.bind(result.values)(sign);

A dynamically assembled definition vector also remains a false green:

TypeScript
const result: Record<string, unknown> = {};
const args: any[] = [];
args[0] = result;
args[1] = "signer";
args[2] = sign;
Reflect.apply(Reflect.set, null, args);
return result as unknown as string;

The same occurs when the vector is created with concat(result, "signer", sign).

At tests/admin-auth-boundary.test.ts:856-888, receiverMutationCall recognizes a direct mutator call or one direct .call/.apply layer. It does not resolve the actual receiver through Function.prototype.call.call, Function.prototype.apply.call, or a bound prototype method. 

attachments-bundle(17)

 For dynamic definition vectors, the graph understands the exact args.push(result, key, sign) fixture but does not connect indexed writes or a concat result back to the actual target object. The exact direct prototype and push-built vector fixtures are present and green. 

attachments-bundle(17)

Impact: clearAdminCookieHeader or another allowed export can return an object containing the private signer or bearer verifier while the checker reports that no private authority escaped.

Exact fixtures and safe differentials

The tests included in this candidate do what they assert:

Every listed round-eleven hostile fixture produces a violation.

Safe reflected reads remain admitted.

Harmless global mutations remain admitted.

Safe dynamic apply vectors remain admitted.

Safe prototype mutations remain admitted.

The unaugmented direct source export construction remains admitted.

The integration test evidence reports all 89 test files and 2,337 tests passed, with zero failed, pending, or todo tests. 

attachments-bundle(17)

The problem is therefore not that a listed fixture unexpectedly passed or that the checker became overbroad. It is that the implementation claims semantic identity propagation across the whole class, while its data flow still stops at closely equivalent AST shapes. The manifest’s stated round-eleven closure is consequently not established. 

attachments-bundle(17)

Runtime controls not independently refuted

Apart from the authority-admission defects above, the changed runtime design is internally coherent:

Control	Review result
Password principal	Forces viewer, method=password, thirty-minute expiry, aggregate and logout only
Review-token principal	Signs method=review, retains configured role, twelve-hour expiry
Aggregate query	Reads bounded payload-safe lead and voice rows with normalized take
DTO validation	Convex declares a fixed return validator; Next independently rejects missing, extra, nonnumeric, nonfinite, negative, fractional-count, count-over-take, percentage-over-100, and child-over-parent values
Page/API separation	Password page and metrics route use only getAdminAggregateMetrics; raw dashboard and lead-table paths are not invoked
One-time mint claims	Module-private WeakMap; exact object lookup; claims deleted before mint; caller-visible fields are ignored
Collision handling	Password equality with review, ops, or privacy bearer fails every auth plane closed
Rotation	Review-token rotation invalidates stale password HMACs and both session methods
Canonical release target	Only the two canonical HTTPS root origins are accepted; alternate non-default ports, paths, queries, fragments, userinfo, HTTP, and compatibility hosts are rejected
Release proof command	Requires credentials/browser/target, hard-fails on runner or JSON failure, requires nonzero expected tests and zero skipped, flaky, or unexpected tests
Telemetry	Successful-login telemetry contains only bounded actor/method/role/expiry metadata, not credentials, HMACs, cookies, or request bodies

The focused suite also exercises aggregate bounds, raw-path non-use, one-time claims, collision cross-products, bearer rejection, rotation, and managed-environment parity. 

attachments-bundle

 These controls make the password design materially safer, but they do not compensate for a release checker that can falsely certify private-authority escape.

Artifact hashes

I reconstructed every attached artifact from the bundle and recomputed SHA-256 over the raw bytes.

Artifact	Bytes	Recomputed SHA-256	Result
Evidence manifest	21,791	2c6e55728ebe5a478a95575aae4a0b2818fedd02244766f97252d98904706497	Independently computed
Source-only patch	249,566	b2a6060759139711e321ff475eea567674a4c1a9f31529af1463e809f45b1c6f	Matches manifest
github-evidence.json	119,766	46aab7e31c00b7914f0bc8dcc846234cd156ab27ce7c9b13972b26a2bd3ce543	Matches manifest
source-ci.log	71,217	71b4316b38953d43a3e7f43438992e3d4ea59d98550e6b3340ebda5700d1158e	Matches manifest
integration-ci.log	76,676	a8e52af1ef4f23289e68d94706e20030b6e828aa42ad211c561e4ee4ba4502d0	Matches manifest
integration-merge-dag.txt	99,093	4a8926798ced0d9b4ddef8433ac68de8a1f451961cdccd591cfee80437405595	Matches manifest
source-to-integration-overlap.diff	34,002	61654a437f0abb79038add16e78bddbc422a5b43cc7927584c078d723c10c0ee	Matches manifest
integration-vitest.json	865,534	3c0975967b34ced7a382e7b4519f369410b63d62aa2e8f5339561b1d6982e40c	Matches manifest
integration-audit.json	310	e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c	Matches manifest
final-head-github-evidence.json	184,180	19cff878934500eafe1c5af26f9c95f695a6c11cfdbcef1fc9be4e0b29f275cf	Independent final capture
final-head-ci.log	71,056	ca0520c739991595923ad14d3473002b23b6071273b5f8d7d142c5f08cfdd1cb	Independent final capture
source-to-live-head.diff	69,087	711b090aad10f31006a393c96946d84c125d8e82144feb1b9404b9429481bb03	Independent final capture

The manifest-declared support hashes and byte counts are reproduced in the attachment. 

attachments-bundle(17)

Source, integration, and live-head evidence
Source CI

Run 30390585854, job/check 90380851632, suite 82372480006, event pull_request, all report success on head 71f6d0c11eaa9c9885fb0183528b96daf7f5f7b4. The raw checkout attestation reports tree e765a147b2dd9cd3a7ca5c6144ffb6750a7834a2. 

attachments-bundle(17)

The source evidence reports strict application and Convex TypeScript, 85 test files and 2,222 tests, the missing-configuration hard-fail release-proof guard, Next.js 16.2.10 production build, and source diff --check success. 

attachments-bundle(17)

Eight-head integration

Run 30390733647, job/check 90381360568, suite 82372938344, event pull_request, checked out commit 998ba3b2dd9f43feae32d9d7bb7de181e3466246, tree 48b97f55b1cd55e254154b73f7cca7b271b533e1. 

attachments-bundle(17)

All eight listed heads are recorded as ancestors. The integration head’s first-parent composition directly merges the reviewed source commit as its second parent. 

attachments-bundle(17)

 

attachments-bundle(17)

The raw integration gates confirm:

frozen pnpm 10.34.5, explicit version and registry output, and frozen-lockfile install; 

attachments-bundle(17)

zero audit findings across 378 production dependencies; 

attachments-bundle(17)

strict TypeScript;

89 files and 2,337 tests passed with no pending tests; 

attachments-bundle(17)

Next.js 16.2.12 compiled successfully and completed its TypeScript phase; 

attachments-bundle(17)

mobile performance passed with LCP 1,152 ms, CLS 0, 444,009 transferred JavaScript bytes, 15 initial JavaScript requests, and zero serious or critical accessibility violations. 

attachments-bundle(17)

The overlapping-path diff does not modify lib/server/admin-auth.ts, lib/server/admin-route.ts, the login or metrics routes, the boundary checker, or the admin release-proof implementation. Its aggregate-adapter overlap only adds unrelated orphan-session functions; the password aggregate schema is unchanged.

There is a secondary evidence wording error: the manifest says integration lint covered 295 files, while the raw Biome output says 294 files and “No fixes applied.” 

attachments-bundle(17)

 The source manifest similarly says 285 while its raw log says 284. The lint commands themselves passed cleanly; the counts should be corrected when evidence is regenerated.

Live PR head

The final live PR head is 5d579e2be37cffe111fb260eb2fa121dc36099d2, tree 516d8a85d9a935324db39de5622230f8b37261d2. Final run 30391175662, job/check 90382846527, suite 82374271942, event pull_request, all completed successfully on that exact head. 

attachments-bundle(17)

 

attachments-bundle(17)

The source-to-live-head diff contains exactly four final-tree paths, all APR-only:

.apr/evidence/oriental-admin-password-security.md; 

attachments-bundle(17)

.apr/evidence/oriental-admin-password-security.patch; 

attachments-bundle(17)

.apr/rounds/oriental-admin-password-security/round_11.md; 

attachments-bundle(17)

.apr/workflows/oriental-admin-password-security.yaml. 

attachments-bundle(17)

There is no non-APR descendant byte change between the implementation commit and the supplied live head.

Mandatory post-merge gates remain pending

None of the following is proved complete by this pre-merge bundle, and I do not treat any of it as current live state:

Deploy the frozen Convex functions, complete the bounded lifecycle migration, and pass the secondary orphan-sweep verifier before any web deployment mutation. 

attachments-bundle(17)

Derive the reaffirmed password HMAC without logging either input, write it to both governed Infisical scopes, reconcile the complete Coolify environment, and perform exact parity readback.

Deploy the corrected merge SHA to canonical staging and run the clean-cookie browser proof with nonzero expected tests and zero skipped, flaky, unexpected, or failed tests.

Prove live HTTP-only, SameSite and Secure cookie flags; signed method=password, viewer role and thirty-minute expiry; review-token configured role and twelve-hour expiry; password bearer rejection; raw review/lead/transcript/voice/event/analytics/queue/mutation 403s; Redis store identity, shared remaining counts, and exhaustion to 429.

Promote the identical SHA to production only after staging passes, then repeat managed-environment, authentication, health, and exact-running-SHA verification while retaining rollback. 

attachments-bundle(17)

 

attachments-bundle(17)

Required correction

A corrected candidate must implement value-identity propagation rather than enumerate another narrow syntax list:

propagate process/module/global Object/Reflect identity through property access, reflection results, nested and assignment destructuring, containers, and returned values;

propagate allowed-export identity through every value-returning assignment operator and function-return bridge;

resolve the actual receiver through bound calls and arbitrary call/apply chains;

model indexed, concatenated, spread, and otherwise dynamically assembled invocation vectors so protected values are connected to the real mutation target;

add the exact counterexamples above plus safe analogues;

rerun source CI, rebuild the eight-head integration, and regenerate all raw and final-head evidence with the lint counts corrected.

VERDICT: DO NOT MERGE
