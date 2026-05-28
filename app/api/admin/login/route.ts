import { adminLoginSchema } from "@/lib/schemas";
import { adminCookieHeader, createAdminSessionCookie, verifyAdminToken } from "@/lib/server/admin-auth";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = adminLoginSchema.safeParse(raw);
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_payload" }, { status: 400 });

  const auth = verifyAdminToken(parsed.data.token);
  if (!auth.ok) {
    const status = auth.reason === "unconfigured" ? 503 : 401;
    return noStoreJson({ ok: false, error: auth.reason }, { status });
  }

  const cookie = createAdminSessionCookie();
  return noStoreJson(
    { ok: true },
    {
      headers: { "Set-Cookie": adminCookieHeader(cookie, auth.expiresAt) },
    },
  );
}
