# Upgrade Log

## 2026-10-24 — compatible security and application dependency batch

- Updated 31 direct declarations within their existing majors: Next/config 16.4.3, React/DOM 19.3.1, Zod 4.6.7, Sentry 10.76.2, Convex 1.48.0, AWS SESv2 3.1156.0, OpenAI 6.49.0, Base UI 1.9.0, React Hook Form/resolvers 7.91.0/5.9.2, Lucide 1.61.0, and compatible test, CSS, declaration and CLI packages. Retained the existing model, authentication, session and release contracts, TypeScript 6.0.3, pnpm 10.34.5 and browser package boundaries. ESLint 9.39.5 is an EOL-line compatibility patch, not a supported-major migration.
- Updated admitted transitive security packages, including body-parser 2.4.0, proxy-addr 2.0.8, qs 6.16.1, Hono 4.13.13, its Node server 1.19.17, Undici 7.30.1, Vite 8.3.5, brace-expansion 1.1.21/5.0.12 and ip-address 10.7.4. Refreshed the four existing effective package-level override values; native pnpm proves this mapping shadows the workspace overrides, whose bytes remain unchanged. Next's exact PostCSS 8.5.23 remains admitted and safe; it is not forced to the root override's 8.5.31.
- Fresh paired `pnpm audit --json`: 88 findings (4 critical, 31 high, 46 moderate, 7 low) to zero. The final lock is reachable and frozen/offline with scripts disabled. Official metadata/SRI and declared dependency/peer/engine ranges are bound in the qualification packet.
- Actual immutable source with the target dependencies passed all 2,361 existing Vitest tests (two workers), Next type generation, the full project TypeScript check and the production build. Final `pnpm lint` passed with retained Biome 2.5.2. Biome 2.6.2 was rejected for this batch after introducing 93 formatter diagnostics on existing Markdown and TypeScript; the failed proposal is retained as evidence, with no broad formatting rewrite.
- Preserved the original baseline failures: 20 subprocess tests initially lacked the pinned pnpm executable in the cleared fixture PATH; those exact controls subsequently passed. Three inherited stale assertions were refreshed: security-version expectations now match the qualified graph, and the deployment-source regex requires the already-existing POST request options. No deployment implementation changed.
- Selected official package archives and installed files, including host SWC, Sharp, Tailwind, Lightning CSS, Rolldown and esbuild binaries, were verified and rebound after execution. Tests ran with no network and no inherited credentials or repository env files; existing synthetic ports remain explicit. This is source/build qualification, not browser, staging, Convex deployment, provider/model or production acceptance.
- Reproducible qualification packet: `/data/tmp/evergreen-app68-a6b4zwh8/qualification-receipt.json`; original failures and intermediate proposals are retained alongside it.

## 2026-07-06

- Added the official `openai` SDK (`6.45.0`) for Realtime client-secret minting while keeping the existing WebRTC Realtime client flow.
- Refreshed non-major runtime packages, including `next`, `react`, `react-dom`, `@sentry/nextjs`, `convex`, `@aws-sdk/client-sesv2`, `ioredis`, `lucide-react`, and `react-hook-form`.
- Refreshed non-major tooling packages, including Biome, Playwright, Tailwind, Vite React plugin, shadcn, tsx, and Vitest.
- Upgraded `@types/node` to `26.1.0` and `typescript` to `6.0.3`; both passed lint, typecheck, tests, and build.
- Added a `pnpm` override for `js-yaml@4.3.0` to resolve the ESLint transitive audit finding.
- Held `eslint` on `9.39.4` because the current `eslint-config-next`/plugin peer ranges do not support `eslint@10` yet.
- Validation run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm audit --audit-level moderate`.
- Convex codegen/deploy still requires a configured `CONVEX_DEPLOYMENT` or deploy key in the target environment.
