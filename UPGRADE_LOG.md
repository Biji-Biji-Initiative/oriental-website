# Upgrade Log

## 2026-07-06

- Added the official `openai` SDK (`6.45.0`) for Realtime client-secret minting while keeping the existing WebRTC Realtime client flow.
- Refreshed non-major runtime packages, including `next`, `react`, `react-dom`, `@sentry/nextjs`, `convex`, `@aws-sdk/client-sesv2`, `ioredis`, `lucide-react`, and `react-hook-form`.
- Refreshed non-major tooling packages, including Biome, Playwright, Tailwind, Vite React plugin, shadcn, tsx, and Vitest.
- Upgraded `@types/node` to `26.1.0` and `typescript` to `6.0.3`; both passed lint, typecheck, tests, and build.
- Added a `pnpm` override for `js-yaml@4.3.0` to resolve the ESLint transitive audit finding.
- Held `eslint` on `9.39.4` because the current `eslint-config-next`/plugin peer ranges do not support `eslint@10` yet.
- Validation run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm audit --audit-level moderate`.
- Convex codegen/deploy still requires a configured `CONVEX_DEPLOYMENT` or deploy key in the target environment.
