import type { NextRequest } from "next/server";
import { leadRequestSchema } from "@/lib/schemas";
import { persistLead } from "@/lib/server/convex";
import { notifyOwner, notifySlack, routeLead } from "@/lib/server/notifications";
import { checkRateLimit, hashIp, noStoreJson, requestIp, verifyTurnstile } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const limit = checkRateLimit(`lead:${hashIp(ip)}`, 12, 60 * 60 * 1000);
  if (!limit.ok) {
    return noStoreJson({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = leadRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const turnstileOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstileOk) {
    return noStoreJson({ ok: false, error: "turnstile_failed" }, { status: 403 });
  }

  const lead = routeLead(parsed.data);
  if (!lead.routedToEmail && process.env.NODE_ENV === "production") {
    return noStoreJson({ ok: false, error: "routing_unconfigured" }, { status: 500 });
  }

  const persistence = await persistLead(lead);
  const [email, slack] = await Promise.allSettled([notifyOwner(lead), notifySlack(lead)]);

  return noStoreJson({
    ok: true,
    id: persistence.id,
    persisted: persistence.persisted,
    notifications: {
      email: email.status === "fulfilled" ? email.value : { ok: false, error: "ses_failed" },
      slack: slack.status === "fulfilled" ? slack.value : { ok: false, error: "slack_failed" },
    },
  });
}
