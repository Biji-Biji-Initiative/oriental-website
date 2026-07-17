import { spawnSync } from "node:child_process";
import { releaseTestEnv } from "./lib/release-test-env";

const result = spawnSync("pnpm", ["test"], {
  env: releaseTestEnv(process.env),
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
