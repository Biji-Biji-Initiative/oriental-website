import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import { notifyClickUp, type StoredLead } from "@/lib/server/notifications";

type Args = {
  dry: boolean;
  limit: number;
  reconcileExisting: boolean;
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
  notificationClickUpOk?: boolean;
  notificationClickUpTaskId?: string;
  notificationClickUpTaskUrl?: string;
};

type ClickUpTask = {
  id?: string;
  url?: string;
  name?: string;
  text_content?: string;
  description?: string;
  markdown_description?: string;
  markdown_content?: string;
};

type ClickUpReference = {
  id: string;
  url: string;
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
  const existingTasks = await existingClickUpTasks(clickUpToken, clickUpListId);
  const missing = leads.filter((lead) => !existingTasks.has(lead.leadId));
  const reconcileCandidates = leads.filter((lead) => {
    const task = existingTasks.get(lead.leadId);
    return (
      Boolean(task) &&
      (lead.notificationClickUpOk !== true ||
        lead.notificationClickUpTaskId !== task?.id ||
        lead.notificationClickUpTaskUrl !== task?.url)
    );
  });

  console.log(
    JSON.stringify(
      {
        dry: args.dry,
        reconcileExisting: args.reconcileExisting,
        convexLeads: leads.length,
        clickupLeadIdsFound: existingTasks.size,
        missing: missing.length,
        reconcileCandidates: reconcileCandidates.length,
        directLinksStored: leads.filter((lead) => Boolean(lead.notificationClickUpTaskUrl)).length,
      },
      null,
      2,
    ),
  );

  if (args.dry) {
    for (const lead of missing.slice(0, 20)) {
      console.log(`missing ${lead.leadId} ${lead.segment}`);
    }
    return;
  }

  let created = 0;
  let failed = 0;
  for (const lead of missing) {
    const result = await notifyClickUp(toStoredLead(lead));
    if (result.ok && result.transport === "clickup" && result.externalId) {
      const confirmed = await confirmClickUpMirror(convex, ingestSecret, lead.leadId, {
        id: result.externalId,
        url: result.externalUrl ?? clickUpTaskUrl(result.externalId),
      });
      if (confirmed) {
        created += 1;
        console.log(`created ${lead.leadId}`);
      } else {
        failed += 1;
        console.error(`created task but failed to confirm ${lead.leadId}`);
      }
    } else {
      failed += 1;
      const reason = result.ok ? "clickup_task_reference_missing" : (result.error ?? result.reason ?? "unknown");
      console.error(`failed ${lead.leadId}: ${reason}`);
    }
  }

  let reconciled = 0;
  if (args.reconcileExisting) {
    for (const lead of reconcileCandidates) {
      const task = existingTasks.get(lead.leadId);
      if (task && (await confirmClickUpMirror(convex, ingestSecret, lead.leadId, task))) {
        reconciled += 1;
        console.log(`reconciled ${lead.leadId}`);
      } else {
        failed += 1;
        console.error(`failed to reconcile ${lead.leadId}`);
      }
    }
  }

  console.log(JSON.stringify({ created, reconciled, failed, skippedExisting: leads.length - missing.length }, null, 2));
  if (failed > 0) process.exit(1);
}

async function confirmClickUpMirror(
  convex: ConvexHttpClient,
  ingestSecret: string,
  leadId: string,
  task: ClickUpReference,
) {
  const result = await convex.mutation(api.leads.confirmLeadClickUpMirror, {
    ingestSecret,
    leadId,
    clickupTaskId: task.id,
    clickupTaskUrl: task.url,
  });
  return result.ok;
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

async function existingClickUpTasks(token: string, listId: string) {
  const tasksByLeadId = new Map<string, ClickUpReference>();
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
      if (!task.id) continue;
      for (const id of extractLeadIds(task)) {
        if (!tasksByLeadId.has(id)) {
          tasksByLeadId.set(id, { id: task.id, url: task.url ?? clickUpTaskUrl(task.id) });
        }
      }
    }
    if (tasks.length === 0) break;
  }
  return tasksByLeadId;
}

function extractLeadIds(task: ClickUpTask) {
  const text = [task.name, task.text_content, task.description, task.markdown_description, task.markdown_content]
    .filter(Boolean)
    .join("\n");
  return [...text.matchAll(/Lead ID:\*\*\s*([A-Za-z0-9_-]+)/g), ...text.matchAll(/\b([0-9a-f]{8}-[0-9a-f-]{27,})\b/gi)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
}

function clickUpTaskUrl(taskId: string) {
  return `https://app.clickup.com/t/${encodeURIComponent(taskId)}`;
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
  const parsed: Args = { dry: false, limit: 500, reconcileExisting: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dry") parsed.dry = true;
    else if (arg === "--reconcile-existing") parsed.reconcileExisting = true;
    else if (arg === "--limit") {
      parsed.limit = Number(next) || parsed.limit;
      index += 1;
    }
  }
  return parsed;
}
