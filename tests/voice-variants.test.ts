import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_VARIANT_ID, getVoiceVariant, VOICE_VARIANT_IDS, VOICE_VARIANTS } from "@/lib/voice/variants";

describe("voice variants catalog", () => {
  it("offers three to five distinct, well-formed variants", () => {
    expect(VOICE_VARIANTS.length).toBeGreaterThanOrEqual(3);
    expect(VOICE_VARIANTS.length).toBeLessThanOrEqual(5);
    expect(new Set(VOICE_VARIANT_IDS).size).toBe(VOICE_VARIANTS.length);

    for (const variant of VOICE_VARIANTS) {
      expect(variant.id).toMatch(/^[a-z0-9-]+$/);
      expect(variant.label.length).toBeGreaterThan(0);
      expect(variant.blurb.length).toBeGreaterThan(0);
      expect(variant.voice.length).toBeGreaterThan(0);
      expect(variant.speed).toBeGreaterThanOrEqual(0.25);
      expect(variant.speed).toBeLessThanOrEqual(1.5);
      // Persona notes retune register, so they reference Manglish/Bahasa freely,
      // but must not restate the name — the base profile owns Reka's identity.
      expect(variant.personaNote.length).toBeGreaterThan(40);
      expect(variant.personaNote).not.toMatch(/\bReka\b/);
    }
  });

  it("gives every variant a distinct register, voice, and persona", () => {
    expect(new Set(VOICE_VARIANTS.map((variant) => variant.voice)).size).toBe(VOICE_VARIANTS.length);
    expect(new Set(VOICE_VARIANTS.map((variant) => variant.personaNote)).size).toBe(VOICE_VARIANTS.length);
    expect(new Set(VOICE_VARIANTS.map((variant) => variant.speed)).size).toBe(VOICE_VARIANTS.length);
  });

  it("resolves known ids and rejects everything else", () => {
    expect(getVoiceVariant(VOICE_VARIANT_IDS[0])?.id).toBe(VOICE_VARIANT_IDS[0]);
    expect(getVoiceVariant("nope")).toBeUndefined();
    expect(getVoiceVariant(undefined)).toBeUndefined();
    expect(getVoiceVariant(null)).toBeUndefined();
  });

  it("exposes a default that exists in the catalog", () => {
    expect(VOICE_VARIANT_IDS).toContain(DEFAULT_VOICE_VARIANT_ID);
  });
});
