const SAFE_VOICE_RUNTIME_ERROR_CODES = new Set([
  "authentication_error",
  "conversation_already_has_active_response",
  "input_audio_buffer_commit_empty",
  "insufficient_quota",
  "invalid_request_error",
  "permission_error",
  "provider_error",
  "rate_limit_exceeded",
  "response_cancel_not_active",
  "server_error",
  "voice_capture_rejected",
  "voice_capture_rejected_email",
  "voice_email_unconfirmed",
]);

/**
 * Project arbitrary provider/client error input onto a fixed, PII-free
 * diagnostic vocabulary before persistence, logging, analytics, or judging.
 */
export function safeVoiceRuntimeErrorCode(value: string | undefined) {
  const code = value?.trim().toLowerCase();
  return code && SAFE_VOICE_RUNTIME_ERROR_CODES.has(code) ? code : "realtime_error";
}
