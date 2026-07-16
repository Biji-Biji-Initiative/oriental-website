import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { validateManagedVoiceCell, validateReleaseSha } from "./lib/release-governance";

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

function requireText(path: string, pattern: string | RegExp, message: string, failures: string[]) {
  const content = readFileSync(path, "utf8");
  const matches = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  if (!matches) failures.push(message);
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

  requireText(
    "Dockerfile",
    'ENV HOSTNAME="0.0.0.0"',
    "Dockerfile must bind the standalone server to 0.0.0.0",
    failures,
  );
  requireText(
    "scripts/deploy-coolify-host.sh",
    String.raw`image="\${app_uuid}:staging-\${sha}"`,
    "staging must use a distinct staging-<sha> image tag",
    failures,
  );
  requireText(
    "docs/11-INFRASTRUCTURE.md",
    "health-check host is `127.0.0.1`",
    "infrastructure docs must pin Coolify's health-check host to 127.0.0.1",
    failures,
  );
  requireText(
    "docs/12-CHAT-RELEASE-RUNBOOK.md",
    "Final-SHA freeze",
    "the governed release runbook must retain the final-SHA freeze",
    failures,
  );

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
