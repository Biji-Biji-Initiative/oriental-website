/**
 * Voice variants for the team's A/B selection. Each is a distinct timbre
 * (OpenAI realtime voice) + pace (speed) + persona tuning, all sharing Reka's
 * identity and Malaysian KL accent (those live in `VOICE_PROFILE` and are never
 * overridden here — a variant only modulates voice, speed, and tone/energy).
 *
 * This module is the single source of truth: the server resolves the selected
 * id when minting a session (so voice/speed/persona are never client-supplied),
 * and the floating picker renders the same list. Gate the picker with the
 * runtime flag `VOICE_VARIANT_PICKER=true`.
 */
export type VoiceVariant = {
  id: string;
  /** Short title for the picker. */
  label: string;
  /** One-line character description for the picker. */
  blurb: string;
  /** OpenAI realtime voice id. */
  voice: string;
  /** Output speed, clamped server-side to OpenAI's 0.25..1.5 range. */
  speed: number;
  /**
   * Persona-tuning instruction appended to the system prompt. Tone and energy
   * only — must not restate the name or the accent, which the base profile owns.
   */
  personaNote: string;
};

export const VOICE_VARIANTS: readonly VoiceVariant[] = [
  {
    id: "marin-bright",
    label: "Reka · Bright",
    blurb: "Sunny, quick KL host — upbeat and lively.",
    voice: "marin",
    speed: 1.3,
    personaNote:
      "Lean into bright, upbeat KL host energy: quick, sunny, lightly playful. Keep sentences short and lively, and let your enthusiasm show.",
  },
  {
    id: "coral-warm",
    label: "Reka · Warm",
    blurb: "Warm and hospitable — unhurried, welcoming.",
    voice: "coral",
    speed: 1.12,
    personaNote:
      "Lean warm and hospitable, like a gracious KL host welcoming someone in: unhurried, generous with acknowledgement, softly spoken. Never rushed.",
  },
  {
    id: "sage-calm",
    label: "Reka · Calm",
    blurb: "Grounded and reassuring — measured, confident.",
    voice: "sage",
    speed: 1.05,
    personaNote:
      "Lean calm and grounded: measured pace, reassuring, quietly confident. Let small pauses breathe and never sound hurried.",
  },
  {
    id: "shimmer-spark",
    label: "Reka · Spark",
    blurb: "Youthful and curious — fast and playful.",
    voice: "shimmer",
    speed: 1.34,
    personaNote:
      "Lean youthful and sparky: fast, curious, energetic, lightly cheeky. Keep momentum high and react with genuine delight.",
  },
  {
    id: "alloy-poised",
    label: "Reka · Poised",
    blurb: "Crisp and polished — confident, articulate.",
    voice: "alloy",
    speed: 1.18,
    personaNote:
      "Lean poised and polished: crisp, articulate, confident, with professional warmth. Precise without sounding corporate or cold.",
  },
] as const;

export const VOICE_VARIANT_IDS = VOICE_VARIANTS.map((variant) => variant.id);

export const DEFAULT_VOICE_VARIANT_ID = VOICE_VARIANTS[0]?.id ?? "marin-bright";

export function getVoiceVariant(id: string | null | undefined): VoiceVariant | undefined {
  if (!id) return undefined;
  return VOICE_VARIANTS.find((variant) => variant.id === id);
}
