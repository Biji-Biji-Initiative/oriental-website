import { isProductionEnv } from "@/lib/env";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VoiceDebugEntry = {
  id: string;
  createdAt: string;
  payload: unknown;
};

const entries: VoiceDebugEntry[] = [];

function disabledResponse() {
  return noStoreJson({ ok: false, error: "not_found" }, { status: 404 });
}

export async function GET() {
  if (isProductionEnv()) return disabledResponse();
  return noStoreJson({ ok: true, entries });
}

export async function POST(request: Request) {
  if (isProductionEnv()) return disabledResponse();
  const payload = await request.json().catch(() => null);
  entries.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  });
  entries.splice(20);
  return noStoreJson({ ok: true });
}
