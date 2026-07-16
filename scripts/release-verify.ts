import {
  CONTROL_VOICE_CELL,
  governedVoiceCell,
  hasCloudflareEdgeHeaders,
  RELEASE_TARGETS,
  type ReleaseTargetName,
  validateHealthPayload,
  validateReleaseSha,
} from "./lib/release-governance";

type Args = {
  sha: string;
  target: ReleaseTargetName | "both";
  checks: number;
  stagingModelCell: "control" | "candidate";
};

function parseArgs(argv: string[]): Args {
  let sha = "";
  let target: Args["target"] = "both";
  let checks = 5;
  let stagingModelCell: Args["stagingModelCell"] = "control";
  const normalizedArgv = argv.filter((argument) => argument !== "--");
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const flag = normalizedArgv[index];
    const value = normalizedArgv[index + 1];
    if (flag === "--sha") {
      sha = value ?? "";
      index += 1;
    } else if (flag === "--target") {
      if (value !== "staging" && value !== "production" && value !== "both") {
        throw new Error("--target must be staging, production, or both");
      }
      target = value;
      index += 1;
    } else if (flag === "--checks") {
      checks = Number(value);
      index += 1;
    } else if (flag === "--staging-model-cell") {
      if (value !== "control" && value !== "candidate") {
        throw new Error("--staging-model-cell must be control or candidate");
      }
      stagingModelCell = value;
      index += 1;
    } else if (flag === "--help") {
      process.stdout.write(
        "Usage: pnpm release:verify -- --sha <40-char-sha> [--target staging|production|both] [--checks 5] [--staging-model-cell control|candidate]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  const shaFailures = validateReleaseSha(sha);
  if (shaFailures.length > 0) throw new Error(shaFailures.join("; "));
  if (!Number.isInteger(checks) || checks < 1 || checks > 10)
    throw new Error("--checks must be an integer from 1 to 10");
  if (target === "production" && stagingModelCell !== "control") {
    throw new Error("--staging-model-cell candidate is invalid when verifying production only");
  }
  return { sha, target, checks, stagingModelCell };
}

async function get(url: string, redirect: RequestRedirect = "follow") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { cache: "no-store", redirect, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyTarget(
  name: ReleaseTargetName,
  expectedSha: string,
  checks: number,
  stagingModelCell: Args["stagingModelCell"],
) {
  const target = RELEASE_TARGETS[name];
  const expectedVoiceCell = name === "staging" ? governedVoiceCell(stagingModelCell) : CONTROL_VOICE_CELL;
  const healthChecks: unknown[] = [];
  for (let index = 0; index < checks; index += 1) {
    const response = await get(`${target.origin}/api/health`);
    if (!response.ok) throw new Error(`${name} health returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const failures = validateHealthPayload(payload, expectedSha, expectedVoiceCell);
    if (failures.length > 0) throw new Error(`${name} health: ${failures.join("; ")}`);
    healthChecks.push(payload);
  }

  const configResponse = await get(`${target.origin}/api/client-config`);
  if (!configResponse.ok) throw new Error(`${name} client config returned HTTP ${configResponse.status}`);
  const config = (await configResponse.json()) as { voiceVariantPicker?: unknown };
  if (config.voiceVariantPicker !== false) throw new Error(`${name} voiceVariantPicker must be false`);

  const canonicalResponse = await get(`${target.origin}/`, "manual");
  if (canonicalResponse.status !== 200)
    throw new Error(`${name} canonical root returned HTTP ${canonicalResponse.status}`);
  if (hasCloudflareEdgeHeaders(canonicalResponse.headers)) {
    throw new Error(`${name} unexpectedly returned Cloudflare edge headers`);
  }

  const legacyResponse = await get(`${target.legacyOrigin}/`, "manual");
  if (legacyResponse.status !== 301) throw new Error(`${name} legacy host returned HTTP ${legacyResponse.status}`);
  const expectedLocation = `${target.origin}/`;
  if (legacyResponse.headers.get("location") !== expectedLocation) {
    throw new Error(`${name} legacy redirect must point to ${expectedLocation}`);
  }

  return {
    target: name,
    origin: target.origin,
    version: expectedSha,
    consecutiveHealthChecks: healthChecks.length,
    convex: true,
    voiceVariantPicker: false,
    voiceModel: expectedVoiceCell.model,
    voiceModelCell: expectedVoiceCell.modelCell,
    cloudflareEdgeHeaders: false,
    legacyRedirect: expectedLocation,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names: ReleaseTargetName[] = args.target === "both" ? ["staging", "production"] : [args.target];
  const results = [];
  for (const name of names) {
    results.push(await verifyTarget(name, args.sha, args.checks, args.stagingModelCell));
  }
  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`release-verify: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
