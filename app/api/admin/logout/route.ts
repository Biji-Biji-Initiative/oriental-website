import { clearAdminCookieHeader } from "@/lib/server/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = Response.redirect(new URL("/admin/session-review", request.url), 303);
  response.headers.set("Set-Cookie", clearAdminCookieHeader());
  return response;
}
