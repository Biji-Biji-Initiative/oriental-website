import { adminAuthFailureStatus, clearAdminCookieHeader, verifyAdminPermission } from "@/lib/server/admin-auth";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = verifyAdminPermission(request, "dashboard.read");
  if (!auth.ok) {
    return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
  }
  const response = noStoreJson({ ok: true });
  response.headers.set("Set-Cookie", clearAdminCookieHeader());
  return response;
}
