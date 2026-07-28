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

function dependencyMaps(snapshot: unknown, location: string) {
  if (!isRecord(snapshot)) throw new Error(`${location} must be an object-valued graph node`);
  return ["dependencies", "optionalDependencies"].flatMap((key) => {
    const value = snapshot[key];
    if (value === undefined) return [];
    if (!isRecord(value)) throw new Error(`${location}.${key} must be an object-valued dependency map`);
    return [value];
  });
}

type RegistryDependencyReference = {
  declaredName: string;
  snapshotKey: string;
  targetName: string;
  targetVersion: string;
};

function isRegistryPackageName(name: string) {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu.test(name);
}

function splitRegistryIdentity(value: string) {
  const delimiter = value.startsWith("@") ? value.indexOf("@", value.indexOf("/") + 1) : value.indexOf("@");
  if (delimiter <= 0) return undefined;
  return { name: value.slice(0, delimiter), reference: value.slice(delimiter + 1) };
}

function validRegistrySuffix(suffix: string) {
  if (!suffix) return true;
  const groupHasContent: boolean[] = [];
  for (const character of suffix) {
    if (character === "(") groupHasContent.push(false);
    else if (character === ")") {
      if (groupHasContent.length === 0 || groupHasContent.pop() !== true) return false;
    } else {
      if (!/[a-z0-9@/._=+-]/iu.test(character) || groupHasContent.length === 0) return false;
      groupHasContent[groupHasContent.length - 1] = true;
    }
  }
  return groupHasContent.length === 0;
}

function parseRegistryVersion(reference: string) {
  const suffixIndex = reference.indexOf("(");
  const version = suffixIndex < 0 ? reference : reference.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : reference.slice(suffixIndex);
  if (!valid(version) || !validRegistrySuffix(suffix)) return undefined;
  return { version, versionWithSuffix: `${version}${suffix}` };
}

function registryDependencyReference(name: string, reference: unknown): RegistryDependencyReference | undefined {
  if (typeof reference !== "string" || !isRegistryPackageName(name)) return undefined;
  if (reference.startsWith("npm:")) {
    const identity = splitRegistryIdentity(reference.slice(4));
    if (!identity || !isRegistryPackageName(identity.name)) return undefined;
    const parsedVersion = parseRegistryVersion(identity.reference);
    return parsedVersion
      ? {
          declaredName: name,
          snapshotKey: `${identity.name}@${parsedVersion.versionWithSuffix}`,
          targetName: identity.name,
          targetVersion: parsedVersion.version,
        }
      : undefined;
  }
  const parsedVersion = parseRegistryVersion(reference);
  return parsedVersion
    ? {
        declaredName: name,
        snapshotKey: `${name}@${parsedVersion.versionWithSuffix}`,
        targetName: name,
        targetVersion: parsedVersion.version,
      }
    : undefined;
}

export function governedSnapshotEdgeProblems(source: string) {
  const { snapshots } = parseLockfile(source);
  const problems: string[] = [];
  for (const [snapshotKey, snapshot] of Object.entries(snapshots)) {
    for (const dependencies of dependencyMaps(snapshot, `snapshots.${snapshotKey}`)) {
      for (const [name, reference] of Object.entries(dependencies)) {
        const parsed = registryDependencyReference(name, reference);
        if (!parsed) {
          problems.push(`snapshots.${snapshotKey} has a non-registry dependency edge for ${name}`);
          continue;
        }
        if (governedResolution(name) && parsed.targetName !== name) {
          problems.push(`snapshots.${snapshotKey} aliases governed ${name} to different package ${parsed.targetName}`);
        }
        const declaredProblem = governedVersionProblem(name, parsed.targetVersion, `snapshots.${snapshotKey}`);
        if (declaredProblem) problems.push(declaredProblem);
        if (parsed.targetName !== name) {
          const targetProblem = governedVersionProblem(
            parsed.targetName,
            parsed.targetVersion,
            `snapshots.${snapshotKey} alias target`,
          );
          if (targetProblem) problems.push(targetProblem);
        }
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

function resolveSnapshotKey(name: string, reference: string, packages: UnknownRecord, snapshots: UnknownRecord) {
  const parsed = registryDependencyReference(name, reference);
  if (!parsed) throw new Error(`cannot audit non-registry production dependency ${name}@${reference}`);
  const snapshot = snapshots[parsed.snapshotKey];
  if (!Object.hasOwn(snapshots, parsed.snapshotKey)) {
    throw new Error(`production dependency edge ${name}@${reference} has no snapshot`);
  }
  if (!isRecord(snapshot)) throw new Error(`snapshot ${parsed.snapshotKey} must be an object-valued graph node`);
  const packageKey = `${parsed.targetName}@${parsed.targetVersion}`;
  if (!Object.hasOwn(packages, packageKey)) {
    throw new Error(`production snapshot ${parsed.snapshotKey} has no package metadata ${packageKey}`);
  }
  if (!isRecord(packages[packageKey])) {
    throw new Error(`packages.${packageKey} must be an object-valued graph node`);
  }
  return parsed.snapshotKey;
}

export function collectProductionSnapshotKeys(source: string) {
  const { importers, packages, snapshots } = parseLockfile(source);
  const root = requiredRecord(importers, ".");
  const roots = dependencyMaps(root, "importers..");
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
    const key = resolveSnapshotKey(name, reference, packages, snapshots);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const dependencies of dependencyMaps(snapshots[key], `snapshots.${key}`)) {
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
  for (const dependencies of dependencyMaps(snapshot, `snapshots.${snapshotKey}`)) {
    const reference = dependencies[dependencyName];
    if (typeof reference === "string") return reference;
  }
  return undefined;
}
