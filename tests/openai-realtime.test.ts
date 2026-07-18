import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeClientSecret } from "@/lib/server/openai-realtime";

const originalEnv = process.env;

describe("createRealtimeClientSecret", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: "sk-test",
      OPENAI_REALTIME_MODEL: "gpt-realtime-2",
      OPENAI_REALTIME_VOICE: "marin",
      OPENAI_REALTIME_SPEED: "1.12",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("creates a Realtime 2 browser session with voice profile defaults", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_123" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result).toEqual({
      client_secret: { value: "client-secret", expires_at: 123 },
      session_id: "sess_123",
      model: "gpt-realtime-2",
      model_cell: "control",
      reasoning_cell: "low",
      voice: "marin",
      speed: 1.12,
      variant: null,
      runtime_profile: "baseline",
      input_policy: "baseline",
      email_capture_mode: "strict",
      transcription_model: "gpt-4o-transcribe",
      noise_reduction: "far_field",
      limits: { max_duration_ms: 600_000, idle_timeout_ms: 20_000, idle_goodbye_grace_ms: 6_000 },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("openai-safety-identifier")).toBe("safe-user");

    expect(init).toBeDefined();
    const body = JSON.parse(String(init?.body));
    expect(body.expires_after).toEqual({ anchor: "created_at", seconds: 300 });
    expect(body.session).toMatchObject({
      type: "realtime",
      model: "gpt-realtime-2",
      output_modalities: ["audio"],
      reasoning: { effort: "low" },
      audio: {
        input: {
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: true,
            interrupt_response: true,
          },
          transcription: { model: "gpt-4o-transcribe" },
          noise_reduction: { type: "far_field" },
        },
        output: { voice: "marin", speed: 1.12 },
      },
      truncation: {
        type: "retention_ratio",
        retention_ratio: 0.8,
        token_limits: { post_instructions: 8000 },
      },
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(body.session.instructions).toContain("# Role and Objective");
    expect(body.session.instructions).toContain("# Tool Contract");
    expect(body.session.instructions).not.toContain("What office sizes are available on the 3rd floor?");
    expect(body.session.instructions).toContain("Initial Context");
    expect(body.session.audio.input.transcription.prompt).toContain("Mereka");
    expect(body.session.audio.input.transcription.prompt).toContain("Bahasa Melayu");
    expect(body.session.audio.input.transcription.language).toBeUndefined();
    expect(body.session.tools.map((tool: { name: string }) => tool.name)).toContain("wait_for_user");
    expect(body.session.tools.map((tool: { name: string }) => tool.name)).toContain("lookup_oriental");
    expect(body.session.tools.map((tool: { name: string }) => tool.name)).toContain("capture_fields");
  });

  it("enables the low-friction email contract only when explicitly configured", async () => {
    process.env.VOICE_EMAIL_CAPTURE_MODE = "adaptive";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_adaptive_email" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result.email_capture_mode).toBe("adaptive");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.instructions).toContain("without asking for a separate yes");
    expect(body.session.instructions).toContain("ask the visitor to type it there");
    expect(body.session.instructions).not.toContain(
      "After a speech email is captured, read it back and use confirm_email",
    );
  });

  it("keeps the latency profile independent from the selected voice variant", async () => {
    process.env.VOICE_RUNTIME_PROFILE = "instant-v1";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_instant" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology", "desktop", "malay-warm");

    expect(result.runtime_profile).toBe("instant-v1");
    expect(result.input_policy).toBe("fast");
    expect(result.variant).toBe("malay-warm");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.audio.input.turn_detection).toMatchObject({ type: "semantic_vad", eagerness: "high" });
  });

  it("selects a candidate model and minimal reasoning as independent cells", async () => {
    process.env.VOICE_MODEL_CELL = "candidate";
    process.env.OPENAI_REALTIME_MODEL_CANDIDATE = "gpt-realtime-2.1";
    process.env.VOICE_REASONING_CELL = "minimal";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_candidate" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology", "desktop", undefined, "staging");

    expect(result).toMatchObject({
      model: "gpt-realtime-2.1",
      model_cell: "candidate",
      reasoning_cell: "minimal",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session).toMatchObject({ model: "gpt-realtime-2.1", reasoning: { effort: "minimal" } });
  });

  it("uses near-field noise reduction for mobile sessions", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_mobile" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology", "mobile");

    expect(result.noise_reduction).toBe("near_field");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.audio.input.noise_reduction).toEqual({ type: "near_field" });
  });

  it("applies a selected voice variant's voice, speed, and persona", async () => {
    process.env.OPENAI_REALTIME_VOICE = "marin";
    process.env.OPENAI_REALTIME_SPEED = "1.18";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_variant" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology", "desktop", "malay-warm");

    expect(result.variant).toBe("malay-warm");
    expect(result.voice).toBe("coral");
    expect(result.speed).toBe(1.06);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.audio.output).toEqual({ voice: "coral", speed: 1.06 });
    expect(body.session.instructions).toContain("# Voice Variant Tuning");
  });

  it("falls back to the env voice when the variant id is unknown", async () => {
    process.env.OPENAI_REALTIME_VOICE = "marin";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_unknown_variant" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology", "desktop", "does-not-exist");

    expect(result.variant).toBeNull();
    expect(result.voice).toBe("marin");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.instructions).not.toContain("# Voice Variant Tuning");
  });

  it("serves env-tuned session limits to the client", async () => {
    process.env.VOICE_MAX_DURATION_MS = "300000";
    process.env.VOICE_IDLE_TIMEOUT_MS = "30000";
    process.env.VOICE_IDLE_GOODBYE_GRACE_MS = "8000";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_limits" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result.limits).toEqual({
      max_duration_ms: 300_000,
      idle_timeout_ms: 30_000,
      idle_goodbye_grace_ms: 8_000,
    });
  });

  it("allows overriding the transcription model from the environment", async () => {
    process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_stt" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result.transcription_model).toBe("gpt-realtime-whisper");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.audio.input.transcription.model).toBe("gpt-realtime-whisper");
  });

  it("unwraps quoted Infisical model and voice values before calling OpenAI", async () => {
    process.env.OPENAI_REALTIME_MODEL = "'gpt-realtime-2'";
    process.env.OPENAI_REALTIME_VOICE = "'marin'";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_quoted" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result.model).toBe("gpt-realtime-2");
    expect(result.voice).toBe("marin");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.model).toBe("gpt-realtime-2");
    expect(body.session.audio.output.voice).toBe("marin");
  });

  it("unwraps quoted Infisical model, voice, and speed values before calling OpenAI", async () => {
    process.env.OPENAI_REALTIME_MODEL = "'gpt-realtime-2'";
    process.env.OPENAI_REALTIME_VOICE = "'marin'";
    process.env.OPENAI_REALTIME_SPEED = "'1.2'";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_quoted" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result.model).toBe("gpt-realtime-2");
    expect(result.voice).toBe("marin");
    expect(result.speed).toBe(1.2);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.model).toBe("gpt-realtime-2");
    expect(body.session.audio.output.voice).toBe("marin");
    expect(body.session.audio.output.speed).toBe(1.2);
  });

  it("clamps invalid Realtime speed values to the supported OpenAI range", async () => {
    process.env.OPENAI_REALTIME_SPEED = "9";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_speed" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRealtimeClientSecret("safe-user", "technology");

    expect(result.speed).toBe(1.5);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.audio.output.speed).toBe(1.5);
  });
});
