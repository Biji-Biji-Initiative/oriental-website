import type { SegmentId } from "@/lib/segments";
import { buildVoiceInstructions, VOICE_SESSION_DEFAULTS, VOICE_TOOLS } from "@/lib/voice/profile";

export async function createRealtimeClientSecret(safetyIdentifier: string, initialSegment?: SegmentId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("openai_unconfigured");
  }

  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 300 },
      session: {
        type: "realtime",
        model,
        instructions: buildVoiceInstructions(undefined, initialSegment),
        output_modalities: ["audio"],
        reasoning: { effort: VOICE_SESSION_DEFAULTS.reasoningEffort },
        truncation: VOICE_SESSION_DEFAULTS.truncation,
        audio: {
          input: {
            turn_detection: VOICE_SESSION_DEFAULTS.turnDetection,
            transcription: { model: VOICE_SESSION_DEFAULTS.transcriptionModel },
          },
          output: { voice },
        },
        tools: VOICE_TOOLS,
        tool_choice: "auto",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`openai_${response.status}`);
  }

  const data = (await response.json()) as {
    value?: string;
    expires_at?: number;
    session?: { id?: string };
    client_secret?: { value?: string; expires_at?: number };
    id?: string;
  };
  const value = data.client_secret?.value ?? data.value;
  if (!value) {
    throw new Error("openai_invalid_secret");
  }
  return {
    client_secret: {
      value,
      expires_at: data.client_secret?.expires_at ?? data.expires_at ?? 0,
    },
    session_id: data.session?.id ?? data.id ?? crypto.randomUUID(),
    model,
    voice,
  };
}
