import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import { notifyClickUp, type StoredLead } from "@/lib/server/notifications";

type Args = {
  dry: boolean;
  limit: number;
};

type ConvexLead = {
  leadId: string;
  source: StoredLead["source"];
  segment: StoredLead["segment"];
  routedTo: string;
  routedToEmail?: string | null;
  name: string;
  email: string;
  org: string;
  phone?: string;
  website?: string;
  message: string;
  transcript: StoredLead["transcript"];
  utm: Record<string, string>;
};

type ClickUpTask = {
  id?: string;
  name?: string;
  text_content?: string;
  description?: string;
  markdown_description?: string;
  markdown_content?: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  const clickUpToken = readEnv("CLICKUP_API_TOKEN") ?? readEnv("CLICKUP_API_KEY");
  const clickUpListId = getClickUpListId();

  if (!convexUrl || !ingestSecret) throw new Error("Missing CONVEX_URL/CONVEX_INGEST_SECRET.");
  if (!clickUpToken || !clickUpListId) throw new Error("Missing CLICKUP_API_TOKEN/CLICKUP_LIST_ID.");

  const convex = new ConvexHttpClient(convexUrl);
  const leads = (await convex.query(api.leads.leadsForClickUpBackfill, {
    ingestSecret,
    limit: args.limit,
  })) as ConvexLead[];
  const existingLeadIds = await existingClickUpLeadIds(clickUpToken, clickUpListId);
  const missing = leads.filter((lead) => !existingLeadIds.has(lead.leadId));

  console.log(
    JSON.stringify(
      {
        dry: args.dry,
        convexLeads: leads.length,
        clickupLeadIdsFound: existingLeadIds.size,
        missing: missing.length,
      },
      null,
      2,
    ),
  );

  if (args.dry) {
    for (const lead of missing.slice(0, 20)) {
      console.log(`missing ${lead.leadId} ${lead.segment} ${lead.email}`);
    }
    return;
  }

  let created = 0;
  let failed = 0;
  for (const lead of missing) {
    const result = await notifyClickUp(toStoredLead(lead));
    if (result.ok) {
      created += 1;
      console.log(`created ${lead.leadId}`);
    } else {
      failed += 1;
      console.error(`failed ${lead.leadId}: ${result.error ?? result.reason ?? "unknown"}`);
    }
  }

  console.log(JSON.stringify({ created, failed, skippedExisting: leads.length - missing.length }, null, 2));
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

function toStoredLead(lead: ConvexLead): StoredLead {
  return {
    id: lead.leadId,
    source: lead.source,
    segment: lead.segment,
    routedTo: lead.routedTo,
    routedToEmail: lead.routedToEmail ?? null,
    form: {
      name: lead.name,
      email: lead.email,
      org: lead.org,
      phone: lead.phone ?? "",
      website: lead.website ?? "",
      message: lead.message,
    },
    transcript: lead.transcript,
    turnstileToken: "clickup-backfill",
    utm: lead.utm ?? {},
  };
}

async function existingClickUpLeadIds(token: string, listId: string) {
  const leadIds = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`);
    url.searchParams.set("include_closed", "true");
    url.searchParams.set("subtasks", "true");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers: { Authorization: token }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`ClickUp task list failed: ${response.status}`);
    const body = (await response.json()) as { tasks?: ClickUpTask[] };
    const tasks = body.tasks ?? [];
    for (const task of tasks) {
      for (const id of extractLeadIds(task)) leadIds.add(id);
    }
    if (tasks.length === 0) break;
  }
  return leadIds;
}

function extractLeadIds(task: ClickUpTask) {
  const text = [task.name, task.text_content, task.description, task.markdown_description, task.markdown_content]
    .filter(Boolean)
    .join("\n");
  return [...text.matchAll(/Lead ID:\*\*\s*([A-Za-z0-9_-]+)/g), ...text.matchAll(/\b([0-9a-f]{8}-[0-9a-f-]{27,})\b/gi)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
}

function getClickUpListId() {
  const configured =
    readEnv("CLICKUP_LIST_ID") ??
    readEnv("CLICKUP_ORIENTAL_LIST_ID") ??
    readEnv("CLICKUP_LIST_URL") ??
    readEnv("CLICKUP_TARGET_URL");
  if (!configured) return undefined;
  const trimmed = configured.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.match(/\/li\/(\d+)/)?.[1] ?? trimmed.match(/\/list\/(\d+)/)?.[1];
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = { dry: false, limit: 500 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dry") parsed.dry = true;
    else if (arg === "--limit") {
      parsed.limit = Number(next) || parsed.limit;
      index += 1;
    }
  }
  return parsed;
}
