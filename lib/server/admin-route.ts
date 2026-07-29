import type { AdminPermission } from "@/lib/admin-permissions";
import { type AdminAuthState, adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { noStoreJson } from "@/lib/server/security";

type AuthorizedAdmin = Extract<AdminAuthState, { ok: true }>;
type AdminRouteHandler<Context> = (
  request: Request,
  auth: AuthorizedAdmin,
  context: Context,
) => Response | Promise<Response>;

/**
 * The only supported production boundary for non-login admin route handlers.
 * Authorization completes before the protected callback can run, so parsing,
 * network access, persistence, and logging remain unreachable on failure.
 */
export function withAdminPermission<Context = unknown>(
  permission: AdminPermission,
  handler: AdminRouteHandler<Context>,
) {
  return async function authorizedAdminRoute(request: Request, context?: Context) {
    const auth = verifyAdminPermission(request, permission);
    if (!auth.ok) {
      return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
    }
    return handler(request, auth, context as Context);
  };
}
