import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  extractAprVerdict,
  type GitHubIssue,
  isManualGate,
  missingVoiceEvidence,
  parseAheadBehind,
  parseGitHubRepository,
  requestHeadersForUrl,
  summarizeVoiceEvidence,
} from "./lib/ops-status";
import { RELEASE_TARGETS } from "./lib/release-governance";

type Health = {
  ok?: boolean;
  version?: string;
  convex?: boolean;
  voice?: {
    runtime_profile?: string;
    model_cell?: string;
    model?: string;
    reasoning_cell?: string;
    variant_picker?: boolean;
  };
};

type GitHubPull = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  updated_at: string;
  merged_at?: string | null;
  head: { ref: string; sha: string };
};

const jsonOutput = process.argv.includes("--json");
const warnings: string[] = [];

function git(args: string[], timeout = 10_000): string {
  return execFileSync("git", args, { encoding: "utf8", timeout }).trim();
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function isAncestor(ancestor: string, descendant: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { timeout: 10_000 }).status === 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const response = await fetch(url, {
    headers: requestHeadersForUrl(url, token),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

async function fetchHealth(origin: string): Promise<Health | null> {
  try {
    return await fetchJson<Health>(`${origin}/api/health`);
  } catch (error) {
    warnings.push(`health unavailable for ${origin}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function fetchGitHubState(repository: string) {
  const base = `https://api.github.com/repos/${repository}`;
  try {
    const [pulls, allIssues] = await Promise.all([
      fetchJson<GitHubPull[]>(`${base}/pulls?state=open&per_page=100`),
      fetchJson<GitHubIssue[]>(`${base}/issues?state=open&per_page=100`),
    ]);
    const issues = allIssues.filter((issue) => !issue.pull_request);
    return { pulls, issues, manualGates: issues.filter(isManualGate) };
  } catch (error) {
    warnings.push(`GitHub work queue unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { pulls: [] as GitHubPull[], issues: [] as GitHubIssue[], manualGates: [] as GitHubIssue[] };
  }
}

async function associatedPulls(repository: string, sha: string | undefined): Promise<GitHubPull[]> {
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return [];
  try {
    return await fetchJson<GitHubPull[]>(`https://api.github.com/repos/${repository}/commits/${sha}/pulls`);
  } catch (error) {
    warnings.push(
      `PR lookup failed for ${sha.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function branchesContaining(sha: string | undefined): string[] {
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return [];
  return (tryGit(["for-each-ref", "--contains", sha, "--format=%(refname:short)", "refs/remotes/origin"]) ?? "")
    .split("\n")
    .filter((branch) => branch && branch !== "origin" && branch !== "origin/HEAD");
}

function listMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function latestAprReview(root: string) {
  const candidates = listMarkdownFiles(join(root, ".apr", "rounds")).map((path) => {
    const committedAt = Number(tryGit(["log", "-1", "--format=%ct", "--", relative(root, path)]) ?? 0);
    return { path, timestamp: committedAt || statSync(path).mtimeMs / 1000 };
  });
  const latest = candidates.sort((a, b) => b.timestamp - a.timestamp || b.path.localeCompare(a.path))[0];
  if (!latest) return null;
  const markdown = readFileSync(latest.path, "utf8");
  return {
    path: relative(root, latest.path),
    committedAt: new Date(latest.timestamp * 1000).toISOString(),
    verdict: extractAprVerdict(markdown),
  };
}

function latestVoiceEvidence(root: string) {
  const directory = join(root, "eval-reports");
  if (!existsSync(directory)) return missingVoiceEvidence("local eval report unavailable");
  const candidates = readdirSync(directory)
    .filter((name) => name.startsWith("voice-eval-") && name.endsWith(".json"))
    .map((name) => join(directory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const latest = candidates[0];
  if (!latest) return missingVoiceEvidence("local eval report unavailable");
  try {
    return summarizeVoiceEvidence(JSON.parse(readFileSync(latest, "utf8")), relative(root, latest));
  } catch {
    warnings.push(`voice evidence report is unreadable: ${relative(root, latest)}`);
    return missingVoiceEvidence(relative(root, latest));
  }
}

function compactPull(pull: GitHubPull) {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: pull.draft ?? false,
    head: pull.head.ref,
    sha: pull.head.sha,
    url: pull.html_url,
    updatedAt: pull.updated_at,
    mergedAt: pull.merged_at ?? null,
  };
}

function compactIssue(issue: GitHubIssue) {
  return {
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
    owners: issue.assignees.map((assignee) => assignee.login),
    url: issue.html_url,
    updatedAt: issue.updated_at,
  };
}

async function main() {
  const root = git(["rev-parse", "--show-toplevel"]);
  process.chdir(root);
  const fetchResult = spawnSync("git", ["fetch", "--quiet", "--prune", "origin"], { timeout: 20_000 });
  if (fetchResult.status !== 0) warnings.push("git fetch --prune failed; remote branch state may be stale");

  const remote = git(["remote", "get-url", "origin"]);
  const repository = parseGitHubRepository(remote);
  if (!repository) throw new Error(`cannot derive GitHub repository from ${remote}`);

  const [productionHealth, stagingHealth, github] = await Promise.all([
    fetchHealth(RELEASE_TARGETS.production.origin),
    fetchHealth(RELEASE_TARGETS.staging.origin),
    fetchGitHubState(repository),
  ]);
  const deployedShas = [productionHealth?.version, stagingHealth?.version];
  const [productionPulls, stagingPulls] = await Promise.all([
    associatedPulls(repository, productionHealth?.version),
    associatedPulls(repository, stagingHealth?.version),
  ]);

  const branch = tryGit(["symbolic-ref", "--short", "HEAD"]) ?? "detached";
  const headSha = git(["rev-parse", "HEAD"]);
  const mainSha = git(["rev-parse", "origin/main"]);
  const worktreeClean = git(["status", "--porcelain"]) === "";
  const comparison = parseAheadBehind(git(["rev-list", "--left-right", "--count", "origin/main...HEAD"]));
  const voiceEvidence = latestVoiceEvidence(root);

  if (!worktreeClean) warnings.push("worktree is dirty");
  if (comparison.behind > 0) warnings.push(`local HEAD is ${comparison.behind} commit(s) behind origin/main`);
  if (productionHealth?.ok !== true || productionHealth?.convex !== true)
    warnings.push("production health is not fully green");
  if (stagingHealth?.ok !== true || stagingHealth?.convex !== true) warnings.push("staging health is not fully green");
  if (productionHealth?.version && !isAncestor(productionHealth.version, "origin/main")) {
    warnings.push("production SHA is not an ancestor of origin/main");
  }
  if (stagingHealth?.version && !isAncestor(stagingHealth.version, "origin/main")) {
    warnings.push("staging SHA is not an ancestor of origin/main; it must have an owned experiment or release PR");
  }
  if (voiceEvidence.status !== "pass") warnings.push(`voice evidence gate is ${voiceEvidence.status}`);
  if (github.manualGates.length > 0) warnings.push(`${github.manualGates.length} manual gate(s) remain open`);

  const status = {
    generatedAt: new Date().toISOString(),
    repository: {
      slug: repository,
      root,
      branch,
      headSha,
      mainSha,
      worktreeClean,
      behindMain: comparison.behind,
      aheadOfMain: comparison.ahead,
    },
    environments: {
      production: {
        url: RELEASE_TARGETS.production.origin,
        health: productionHealth,
        onMain: productionHealth?.version ? isAncestor(productionHealth.version, "origin/main") : false,
        containingBranches: branchesContaining(productionHealth?.version),
        associatedPullRequests: productionPulls.map(compactPull),
      },
      staging: {
        url: RELEASE_TARGETS.staging.origin,
        health: stagingHealth,
        onMain: stagingHealth?.version ? isAncestor(stagingHealth.version, "origin/main") : false,
        containingBranches: branchesContaining(stagingHealth?.version),
        associatedPullRequests: stagingPulls.map(compactPull),
      },
    },
    github: {
      openPullRequests: github.pulls.map(compactPull),
      openIssues: github.issues.map(compactIssue),
      manualGates: github.manualGates.map(compactIssue),
    },
    review: { latestApr: latestAprReview(root) },
    voice: {
      requiredProductionCell: { runtimeProfile: "baseline", modelCell: "control", reasoningCell: "low" },
      evidenceGate: voiceEvidence,
    },
    deployedShas: [...new Set(deployedShas.filter(Boolean))],
    warnings,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(`Oriental operations status — ${status.generatedAt}`);
  console.log(`repo: ${branch} ${headSha.slice(0, 12)} (${worktreeClean ? "clean" : "dirty"})`);
  for (const [name, environment] of Object.entries(status.environments)) {
    const health = environment.health;
    const voice = health?.voice;
    console.log(
      `${name}: ${health?.version?.slice(0, 12) ?? "unavailable"} ` +
        `${health?.ok && health?.convex ? "healthy" : "unhealthy"} ` +
        `${voice ? `${voice.runtime_profile}/${voice.model_cell}/${voice.reasoning_cell}` : "voice-cell unavailable"}`,
    );
  }
  console.log(
    `open work: ${github.pulls.length} PR(s), ${github.issues.length} issue(s), ${github.manualGates.length} manual gate(s)`,
  );
  console.log(`APR: ${status.review.latestApr?.verdict ?? "unavailable"}`);
  console.log(`voice evidence: ${voiceEvidence.status}`);
  for (const warning of warnings) console.log(`warning: ${warning}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
