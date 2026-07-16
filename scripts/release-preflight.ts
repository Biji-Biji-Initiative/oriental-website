import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { validateManagedVoiceCell, validateReleaseSha, validateReleaseStaticContracts } from "./lib/release-governance";

type Args = {
  sha?: string;
  managedEnv: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { managedEnv: true };
  const normalizedArgv = argv.filter((argument) => argument !== "--");
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const flag = normalizedArgv[index];
    if (flag === "--sha") {
      args.sha = normalizedArgv[index + 1];
      index += 1;
    } else if (flag === "--managed-env") {
      args.managedEnv = true;
    } else if (flag === "--allow-unmanaged") {
      args.managedEnv = false;
    } else if (flag === "--help") {
      process.stdout.write("Usage: pnpm release:preflight -- --sha <40-char-main-sha> [--allow-unmanaged]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const expectedSha = args.sha ?? git("rev-parse", "HEAD");
  const failures = validateReleaseSha(expectedSha);
  const head = git("rev-parse", "HEAD");
  const originMain = git("rev-parse", "origin/main");
  const branch = git("branch", "--show-current");
  const worktree = git("status", "--porcelain");

  if (head !== expectedSha) failures.push(`HEAD ${head} does not match expected SHA ${expectedSha}`);
  if (originMain !== expectedSha) failures.push(`origin/main ${originMain} does not match expected SHA ${expectedSha}`);
  if (branch !== "main") failures.push(`release preflight must run from main, not ${branch || "detached HEAD"}`);
  if (worktree) failures.push("release preflight requires a clean worktree");

  failures.push(...validateReleaseStaticContracts((path) => readFileSync(path, "utf8")));

  if (args.managedEnv) failures.push(...validateManagedVoiceCell(process.env));

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`release-preflight: ${failure}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, sha: expectedSha, branch, managedEnvChecked: args.managedEnv }, null, 2)}\n`,
  );
}

main();
