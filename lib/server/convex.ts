import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { StoredLead } from "@/lib/server/notifications";

export async function persistLead(lead: StoredLead) {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return { id: lead.id, persisted: false as const, reason: "convex_unconfigured" };
  }
  const client = new ConvexHttpClient(convexUrl);
  const result = await client.mutation(api.leads.createLead, { lead });
  return { id: result.id, persisted: true as const };
}
