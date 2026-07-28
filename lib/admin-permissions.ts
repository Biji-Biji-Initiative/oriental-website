import { readEnv } from "@/lib/env";

export const ADMIN_ROLES = ["viewer", "operator", "admin"] as const;
export const ADMIN_PERMISSIONS = [
  "dashboard.aggregate",
  "dashboard.read",
  "session.logout",
  "leads.read",
  "leads.update",
  "leads.bulk_assign",
  "leads.archive",
  "leads.export",
  "voice.read",
  "voice.follow_up",
  "evals.run",
  "ops.sla_check",
  "ops.retention",
  "privacy.delete",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminPrincipal = "interactive" | "password" | "automation" | "privacy";

const interactiveRolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  viewer: ["dashboard.aggregate", "dashboard.read", "session.logout", "leads.read", "voice.read"],
  operator: [
    "dashboard.aggregate",
    "dashboard.read",
    "session.logout",
    "leads.read",
    "leads.update",
    "leads.bulk_assign",
    "leads.archive",
    "leads.export",
    "voice.read",
    "voice.follow_up",
    "evals.run",
  ],
  admin: [
    "dashboard.aggregate",
    "dashboard.read",
    "session.logout",
    "leads.read",
    "leads.update",
    "leads.bulk_assign",
    "leads.archive",
    "leads.export",
    "voice.read",
    "voice.follow_up",
    "evals.run",
  ],
};

const principalPermissions: Record<Exclude<AdminPrincipal, "interactive">, readonly AdminPermission[]> = {
  password: ["dashboard.aggregate", "session.logout"],
  automation: ["evals.run", "ops.sla_check", "ops.retention"],
  privacy: ["privacy.delete"],
};

export function configuredAdminIdentity() {
  return {
    actor: normalizeAdminActor(readEnv("ADMIN_REVIEW_ACTOR")),
    role: normalizeAdminRole(readEnv("ADMIN_REVIEW_ROLE")),
  };
}

export function normalizeAdminRole(value: string | null | undefined): AdminRole {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : "operator";
}

export function isAdminRole(value: string): value is AdminRole {
  return ADMIN_ROLES.includes(value as AdminRole);
}

export function normalizeAdminActor(value: string | null | undefined) {
  const actor = value?.trim();
  return actor && isValidAdminActor(actor) ? actor : "Oriental admin";
}

export function isValidAdminActor(actor: string) {
  return (
    actor.length > 0 &&
    actor.length <= 80 &&
    Array.from(actor).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
  );
}

export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission,
  principal: AdminPrincipal = "interactive",
) {
  return principal === "interactive"
    ? interactiveRolePermissions[role].includes(permission)
    : principalPermissions[principal].includes(permission);
}
