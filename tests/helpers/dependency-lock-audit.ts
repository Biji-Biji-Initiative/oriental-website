import { satisfies, valid } from "semver";
import { parse } from "yaml";

type UnknownRecord = Record<string, unknown>;

type Lockfile = {
  importers: UnknownRecord;
  packages: UnknownRecord;
  snapshots: UnknownRecord;
};

type GovernedResolution = {
  name: string;
  affected: string;
  patched: string;
};

export const governedResolutions: GovernedResolution[] = [
  { name: "brace-expansion", affected: "=5.0.7", patched: "5.0.8" },
  { name: "fast-uri", affected: "=3.1.3", patched: "3.1.4" },
  { name: "postcss", affected: "<8.5.18", patched: "8.5.23" },
  { name: "sharp", affected: "=0.34.5", patched: "0.35.3" },
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(parent: UnknownRecord, key: string): UnknownRecord {
  const value = parent[key];
  if (!isRecord(value)) throw new Error(`pnpm lockfile is missing an object-valued ${key} section`);
  return value;
}

function parseLockfile(source: string): Lockfile {
  const parsed = parse(source);
  if (!isRecord(parsed)) throw new Error("pnpm lockfile root must be an object");
  return {
    importers: requiredRecord(parsed, "importers"),
    packages: requiredRecord(parsed, "packages"),
    snapshots: requiredRecord(parsed, "snapshots"),
  };
}

function packageIdentity(key: string) {
  const delimiter = key.startsWith("@") ? key.indexOf("@", key.indexOf("/") + 1) : key.indexOf("@");
  if (delimiter <= 0) return undefined;
  const name = key.slice(0, delimiter);
  const version = key.slice(delimiter + 1).split("(", 1)[0] ?? "";
  return { name, version };
}

function governedResolution(name: string) {
  return governedResolutions.find((resolution) => resolution.name === name);
}

function governedVersionProblem(name: string, version: string, location: string) {
  const governed = governedResolution(name);
  if (!governed) return undefined;
  if (!valid(version)) return `${location} has a malformed governed version: ${name}@${version}`;
  if (!satisfies(version, governed.affected, { includePrerelease: true })) return undefined;
  return `${location} resolves vulnerable ${name}@${version}; expected ${governed.patched}`;
}

export function governedSectionProblems(source: string, section: "packages" | "snapshots") {
  const lockfile = parseLockfile(source);
  const problems: string[] = [];
  for (const key of Object.keys(lockfile[section])) {
    const identity = packageIdentity(key);
    if (!identity) continue;
    const problem = governedVersionProblem(identity.name, identity.version, `${section}.${key}`);
    if (problem) problems.push(problem);
  }
  return problems;
}

function dependencyMaps(snapshot: unknown) {
  if (!isRecord(snapshot)) return [];
  return ["dependencies", "optionalDependencies"]
    .map((key) => snapshot[key])
    .filter((value): value is UnknownRecord => isRecord(value));
}

function dependencyVersion(reference: unknown) {
  if (typeof reference !== "string") return undefined;
  if (!reference.startsWith("npm:")) return reference.split("(", 1)[0] ?? "";
  const identity = packageIdentity(reference.slice(4));
  return identity?.version ?? "";
}

export function governedSnapshotEdgeProblems(source: string) {
  const { snapshots } = parseLockfile(source);
  const problems: string[] = [];
  for (const [snapshotKey, snapshot] of Object.entries(snapshots)) {
    for (const dependencies of dependencyMaps(snapshot)) {
      for (const [name, reference] of Object.entries(dependencies)) {
        const version = dependencyVersion(reference);
        if (!version) {
          if (governedResolution(name)) {
            problems.push(`snapshots.${snapshotKey} has a non-string governed dependency edge for ${name}`);
          }
          continue;
        }
        const problem = governedVersionProblem(name, version, `snapshots.${snapshotKey}`);
        if (problem) problems.push(problem);
      }
    }
  }
  return problems;
}

export function governedLockfileProblems(source: string) {
  return [
    ...governedSectionProblems(source, "packages"),
    ...governedSectionProblems(source, "snapshots"),
    ...governedSnapshotEdgeProblems(source),
  ];
}

function importerReference(value: unknown) {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  return typeof value.version === "string" ? value.version : undefined;
}

function resolveSnapshotKey(name: string, reference: string, snapshots: UnknownRecord) {
  if (/^(?:file|link|workspace):/u.test(reference)) {
    throw new Error(`cannot audit external production dependency ${name}@${reference}`);
  }
  const candidate = reference.startsWith("npm:") ? reference.slice(4) : `${name}@${reference}`;
  if (!Object.hasOwn(snapshots, candidate)) {
    throw new Error(`production dependency edge ${name}@${reference} has no snapshot`);
  }
  return candidate;
}

export function collectProductionSnapshotKeys(source: string) {
  const { importers, snapshots } = parseLockfile(source);
  const root = requiredRecord(importers, ".");
  const roots = ["dependencies", "optionalDependencies"]
    .map((key) => root[key])
    .filter((value): value is UnknownRecord => isRecord(value));
  const queue: Array<[string, string]> = [];
  for (const dependencies of roots) {
    for (const [name, value] of Object.entries(dependencies)) {
      const reference = importerReference(value);
      if (!reference) throw new Error(`production importer has no version for ${name}`);
      queue.push([name, reference]);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const [name, reference] = queue.pop() as [string, string];
    const key = resolveSnapshotKey(name, reference, snapshots);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const dependencies of dependencyMaps(snapshots[key])) {
      for (const [childName, childReference] of Object.entries(dependencies)) {
        if (typeof childReference !== "string") {
          throw new Error(`snapshot ${key} has a non-string production dependency edge for ${childName}`);
        }
        queue.push([childName, childReference]);
      }
    }
  }
  return visited;
}

export function governedProductionProblems(source: string) {
  const problems: string[] = [];
  for (const key of collectProductionSnapshotKeys(source)) {
    const identity = packageIdentity(key);
    if (!identity) continue;
    const problem = governedVersionProblem(identity.name, identity.version, `production.${key}`);
    if (problem) problems.push(problem);
  }
  return problems;
}

export function snapshotDependencyReference(source: string, snapshotKey: string, dependencyName: string) {
  const { snapshots } = parseLockfile(source);
  const snapshot = snapshots[snapshotKey];
  for (const dependencies of dependencyMaps(snapshot)) {
    const reference = dependencies[dependencyName];
    if (typeof reference === "string") return reference;
  }
  return undefined;
}
