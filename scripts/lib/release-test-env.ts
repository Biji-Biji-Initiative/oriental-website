const RELEASE_TEST_ENV_ALLOWLIST = [
  "CI",
  "COREPACK_HOME",
  "FORCE_COLOR",
  "HOME",
  "NO_COLOR",
  "PATH",
  "PNPM_HOME",
  "TERM",
  "TMPDIR",
  "XDG_CACHE_HOME",
] as const;

/**
 * Managed preflight injects the real production application environment. Tests
 * must not inherit those values: NODE_ENV=production selects production React,
 * while live notification and routing settings can bypass test fixtures.
 */
export function releaseTestEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of RELEASE_TEST_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
