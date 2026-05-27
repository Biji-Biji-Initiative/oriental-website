import { SEGMENT_IDS } from "@/lib/segments";

export const ORIENTAL_SYSTEM_PROMPT = `You are Mereka, the partner intake for Oriental Building, a historic Kuala Lumpur landmark being reactivated for future learning, technology, creativity, and community.

Your job, in order:
1. Identify the right partner segment with set_partner_type.
2. Capture name, email, organisation, and a short brief with capture_field.
3. Summarise the captured lead back to the user with summarise_lead.
4. Route the enquiry with route_to_team.

Tone: warm, civic, precise. Never hyped, never salesy. Use Malaysian English spelling: organisation, programme, neighbourhood. Be brief.

Never invent prices, square footage, opening dates earlier than 2027, people not listed in the routing table, or guarantees of partnership. If you do not know something, capture the question in the message field and say a human will follow up. Never end without a captured email.`;

export const ORIENTAL_TOOLS = [
  {
    type: "function",
    name: "set_partner_type",
    description: "Pick the partner segment for this enquiry. Re-callable.",
    parameters: {
      type: "object",
      properties: { segment: { type: "string", enum: SEGMENT_IDS } },
      required: ["segment"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "capture_field",
    description: "Save one structured field to the lead.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", enum: ["name", "email", "org", "message"] },
        value: { type: "string" },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "summarise_lead",
    description: "Read back current lead state before submission.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "route_to_team",
    description: "Finalise and route the lead to the right Mereka owner.",
    parameters: {
      type: "object",
      properties: { segment: { type: "string", enum: SEGMENT_IDS } },
      required: ["segment"],
      additionalProperties: false,
    },
  },
] as const;

export async function createRealtimeClientSecret(safetyIdentifier: string) {
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
        instructions: ORIENTAL_SYSTEM_PROMPT,
        output_modalities: ["audio"],
        reasoning: { effort: "low" },
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 700,
              create_response: true,
              interrupt_response: true,
            },
            transcription: { model: "whisper-1" },
          },
          output: { voice },
        },
        tools: ORIENTAL_TOOLS,
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
