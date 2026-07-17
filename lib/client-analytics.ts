import { SEGMENT_IDS, type SegmentId } from "@/lib/segments";
import type { SubmissionMethod, VoiceEntryMethod, VoiceEntryPoint } from "@/lib/voice/interaction-attribution";
import { SUBMISSION_METHODS, VOICE_ENTRY_METHODS, VOICE_ENTRY_POINTS } from "@/lib/voice/interaction-attribution";
import { VOICE_VARIANT_IDS, type VoiceVariantId } from "@/lib/voice/variants";

const ANALYTICS_CONSENT_STORAGE_KEY = "oriental_analytics_consent_v1";

export type IntakeAnalyticsEvent =
  | "intake_open"
  | "voice_start"
  | "intake_submit_attempt"
  | "intake_submit_success"
  | "intake_submit_failure"
  | "newsletter_submit_success"
  | "lead_submitted"
  | "voice_lead_submitted"
  | "voice_session_started"
  | "newsletter_signup";

type EntryAttribution = {
  entry_point: VoiceEntryPoint;
  entry_method: VoiceEntryMethod;
};

type SubmissionAttribution = EntryAttribution & {
  submission_method: SubmissionMethod;
  session_mode: "voice" | "form";
  completed_field_count: number;
  voice_field_count: number;
  manual_field_count: number;
  mixed_field_count: number;
  corrected_field_count: number;
};

export type IntakeAnalyticsParametersByEvent = {
  intake_open: EntryAttribution & { intended_mode: "voice" | "form" };
  voice_start: EntryAttribution;
  intake_submit_attempt: SubmissionAttribution;
  intake_submit_success: SubmissionAttribution;
  intake_submit_failure: SubmissionAttribution & {
    failure_class: "email_check_required" | "invalid_fields" | "server_rejected" | "network";
  };
  newsletter_submit_success: EntryAttribution;
  lead_submitted: { segment: SegmentId; source: "form" };
  voice_lead_submitted: { segment: SegmentId; source: "voice" };
  voice_session_started: { segment: SegmentId; voice_variant: VoiceVariantId | "default" };
  newsletter_signup: { placement: "hero" };
};

type IntakeAnalyticsParameter =
  | "entry_point"
  | "entry_method"
  | "intended_mode"
  | "submission_method"
  | "session_mode"
  | "completed_field_count"
  | "voice_field_count"
  | "manual_field_count"
  | "mixed_field_count"
  | "corrected_field_count"
  | "failure_class"
  | "segment"
  | "source"
  | "voice_variant"
  | "placement";

const EVENT_PARAMETER_ALLOWLIST = {
  intake_open: ["entry_point", "entry_method", "intended_mode"],
  voice_start: ["entry_point", "entry_method"],
  intake_submit_attempt: [
    "entry_point",
    "entry_method",
    "submission_method",
    "session_mode",
    "completed_field_count",
    "voice_field_count",
    "manual_field_count",
    "mixed_field_count",
    "corrected_field_count",
  ],
  intake_submit_success: [
    "entry_point",
    "entry_method",
    "submission_method",
    "session_mode",
    "completed_field_count",
    "voice_field_count",
    "manual_field_count",
    "mixed_field_count",
    "corrected_field_count",
  ],
  intake_submit_failure: [
    "entry_point",
    "entry_method",
    "submission_method",
    "session_mode",
    "completed_field_count",
    "voice_field_count",
    "manual_field_count",
    "mixed_field_count",
    "corrected_field_count",
    "failure_class",
  ],
  newsletter_submit_success: ["entry_point", "entry_method"],
  lead_submitted: ["segment", "source"],
  voice_lead_submitted: ["segment", "source"],
  voice_session_started: ["segment", "voice_variant"],
  newsletter_signup: ["placement"],
} as const satisfies Record<IntakeAnalyticsEvent, readonly IntakeAnalyticsParameter[]>;

const FIELD_COUNT_PARAMETERS = new Set<IntakeAnalyticsParameter>([
  "completed_field_count",
  "voice_field_count",
  "manual_field_count",
  "mixed_field_count",
  "corrected_field_count",
]);

const CATEGORY_VALUES: Partial<Record<IntakeAnalyticsParameter, ReadonlySet<string>>> = {
  entry_point: new Set(VOICE_ENTRY_POINTS),
  entry_method: new Set(VOICE_ENTRY_METHODS),
  intended_mode: new Set(["voice", "form"]),
  submission_method: new Set(SUBMISSION_METHODS),
  session_mode: new Set(["voice", "form"]),
  failure_class: new Set(["email_check_required", "invalid_fields", "server_rejected", "network"]),
  segment: new Set(SEGMENT_IDS),
  source: new Set(["voice", "form"]),
  voice_variant: new Set(["default", ...VOICE_VARIANT_IDS]),
  placement: new Set(["hero"]),
};

/**
 * Consent-gated, PII-free product analytics. Callers may pass only bounded
 * categories and numeric counters — never field values, transcripts, emails,
 * free-form errors, URLs, or user identifiers.
 */
export function trackIntakeEvent<Event extends IntakeAnalyticsEvent>(
  event: Event,
  parameters: IntakeAnalyticsParametersByEvent[Event],
) {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY) !== "granted") return;
  } catch {
    return;
  }
  const safeParameters = sanitizeAnalyticsParameters(event, parameters);
  window.gtag?.("event", event, safeParameters);
}

function sanitizeAnalyticsParameters(event: IntakeAnalyticsEvent, parameters: object): Record<string, string | number> {
  const allowed = new Set<string>(EVENT_PARAMETER_ALLOWLIST[event]);
  const safe: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(parameters)) {
    if (!allowed.has(name)) continue;
    const parameter = name as IntakeAnalyticsParameter;
    if (FIELD_COUNT_PARAMETERS.has(parameter)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) safe[name] = value;
      continue;
    }
    const categories = CATEGORY_VALUES[parameter];
    if (typeof value === "string" && categories?.has(value)) safe[name] = value;
  }
  return safe;
}
