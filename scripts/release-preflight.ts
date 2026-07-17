import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  governedVoiceCell,
  validateManagedVoiceCell,
  validateReleaseSha,
  validateReleaseStaticContracts,
} from "./lib/release-governance";

type Args = {
  sha?: string;
  managedEnv: boolean;
  modelCell: "control" | "candidate";
  voiceCellOnly: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { managedEnv: true, modelCell: "control", voiceCellOnly: false };
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
    } else if (flag === "--voice-cell-only") {
      args.voiceCellOnly = true;
    } else if (flag === "--model-cell") {
      const value = normalizedArgv[index + 1];
      if (value !== "control" && value !== "candidate") throw new Error("--model-cell must be control or candidate");
      args.modelCell = value;
      index += 1;
    } else if (flag === "--help") {
      process.stdout.write(
        "Usage: pnpm release:preflight -- --sha <40-char-main-sha> [--allow-unmanaged] [--voice-cell-only] [--model-cell control|candidate]\n",
      );
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
  const expectedVoiceCell = governedVoiceCell(args.modelCell);
  if (args.voiceCellOnly) {
    const failures = validateManagedVoiceCell(process.env, expectedVoiceCell);
    if (failures.length > 0) {
      for (const failure of failures) process.stderr.write(`release-preflight: ${failure}\n`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, voiceCellOnly: true, modelCell: args.modelCell }, null, 2)}\n`);
    return;
  }
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

  if (args.managedEnv) failures.push(...validateManagedVoiceCell(process.env, expectedVoiceCell));

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`release-preflight: ${failure}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, sha: expectedSha, branch, managedEnvChecked: args.managedEnv }, null, 2)}\n`,
  );
}

main();
