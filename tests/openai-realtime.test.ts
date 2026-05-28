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

    const result = await createRealtimeClientSecret("safe-user", "ai");

    expect(result).toEqual({
      client_secret: { value: "client-secret", expires_at: 123 },
      session_id: "sess_123",
      model: "gpt-realtime-2",
      voice: "marin",
      speed: 1.12,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "OpenAI-Safety-Identifier": "safe-user",
        }),
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1];
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
            type: "server_vad",
            create_response: true,
            interrupt_response: true,
          },
          transcription: { model: "whisper-1" },
        },
        output: { voice: "marin", speed: 1.12 },
      },
      truncation: {
        type: "retention_ratio",
        retention_ratio: 0.8,
        token_limits: { post_instructions: 8000 },
      },
      tool_choice: "auto",
    });
    expect(body.session.instructions).toContain("# Role and Objective");
    expect(body.session.instructions).toContain("Initial Context");
    expect(body.session.tools.map((tool: { name: string }) => tool.name)).toContain("wait_for_user");
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

    const result = await createRealtimeClientSecret("safe-user", "ai");

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

    const result = await createRealtimeClientSecret("safe-user", "ai");

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

    const result = await createRealtimeClientSecret("safe-user", "ai");

    expect(result.speed).toBe(1.5);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.session.audio.output.speed).toBe(1.5);
  });
});
