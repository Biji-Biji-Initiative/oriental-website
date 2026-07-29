import { clearAdminCookieHeader } from "@/lib/server/admin-auth";
import { withAdminPermission } from "@/lib/server/admin-route";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAdminPermission("session.logout", async () => {
  const response = noStoreJson({ ok: true });
  response.headers.set("Set-Cookie", clearAdminCookieHeader());
  return response;
});
