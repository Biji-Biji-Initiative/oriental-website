import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import type { StoredLead } from "@/lib/server/notifications";

export async function persistLead(lead: StoredLead) {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) {
    return { id: lead.id, persisted: false as const, reason: "convex_unconfigured" };
  }
  const client = new ConvexHttpClient(convexUrl);
  const result = await client.mutation(api.leads.createLead, { lead, ingestSecret });
  return { id: result.id, persisted: true as const };
}
