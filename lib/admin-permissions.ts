import { readEnv } from "@/lib/env";

export const ADMIN_ROLES = ["viewer", "operator", "admin"] as const;
export const ADMIN_PERMISSIONS = [
  "dashboard.read",
  "leads.read",
  "leads.update",
  "leads.bulk_assign",
  "leads.export",
  "voice.read",
  "voice.follow_up",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  viewer: ["dashboard.read", "leads.read", "voice.read"],
  operator: [
    "dashboard.read",
    "leads.read",
    "leads.update",
    "leads.bulk_assign",
    "leads.export",
    "voice.read",
    "voice.follow_up",
  ],
  admin: ADMIN_PERMISSIONS,
};

export function configuredAdminIdentity() {
  return {
    actor: readEnv("ADMIN_REVIEW_ACTOR")?.trim() || "Oriental admin",
    role: normalizeAdminRole(readEnv("ADMIN_REVIEW_ROLE")),
  };
}

export function normalizeAdminRole(value: string | null | undefined): AdminRole {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : "operator";
}

export function hasAdminPermission(role: AdminRole, permission: AdminPermission) {
  return rolePermissions[role].includes(permission);
}
