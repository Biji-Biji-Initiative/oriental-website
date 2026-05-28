type VoiceDebugResponse = {
  ok?: boolean;
  entries?: VoiceDebugEntry[];
};

type VoiceDebugEntry = {
  id: string;
  createdAt: string;
  payload?: {
    segment?: string;
    status?: string;
    connectionStatus?: string;
    captured?: Record<string, string>;
    transcript?: Array<{ role?: string; text?: string }>;
    usage?: Record<string, number>;
    errors?: Array<{ eventId?: string; message?: string }>;
  };
};

const url = process.argv[2] ?? process.env.VOICE_DEBUG_URL ?? "http://localhost:3000/api/voice/debug";

void main();

async function main() {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Voice debug unavailable: HTTP ${response.status}`);
    process.exit(1);
  }

  const body = (await response.json()) as VoiceDebugResponse;
  if (body.ok !== true || !Array.isArray(body.entries)) {
    console.error("Voice debug returned an unexpected payload.");
    process.exit(1);
  }

  if (body.entries.length === 0) {
    console.log("No voice debug entries yet.");
    process.exit(0);
  }

  for (const entry of body.entries.slice(0, 5)) {
    const payload = entry.payload ?? {};
    console.log(`\n# ${entry.createdAt} ${entry.id}`);
    console.log(
      `segment=${payload.segment ?? "unknown"} status=${payload.status ?? "unknown"} voice=${payload.connectionStatus ?? "unknown"}`,
    );

    const captured = payload.captured ?? {};
    console.log("captured:");
    for (const key of ["name", "email", "org", "message"]) {
      console.log(`  ${key}: ${captured[key] || "[empty]"}`);
    }

    if (payload.errors?.length) {
      console.log("errors:");
      for (const error of payload.errors) {
        console.log(`  - ${error.eventId ? `${error.eventId}: ` : ""}${error.message ?? "unknown"}`);
      }
    }

    if (payload.usage) {
      console.log(
        `usage: responses=${payload.usage.responseCount ?? 0} responseTokens=${payload.usage.responseTokens ?? 0} transcriptions=${payload.usage.transcriptionCount ?? 0}`,
      );
    }

    const transcript = payload.transcript ?? [];
    if (transcript.length > 0) {
      console.log("transcript:");
      for (const turn of transcript) {
        console.log(`  ${turn.role ?? "unknown"}: ${turn.text ?? ""}`);
      }
    }
  }
}
