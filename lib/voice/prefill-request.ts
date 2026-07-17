export type EmailPrefillRequest<TPrefill extends { email?: string }> = {
  id: number;
  prefill?: TPrefill;
};

/** Remove only the email carried by the matching one-shot request. */
export function revokePrefillRequestEmail<TPrefill extends { email?: string }>(
  current: EmailPrefillRequest<TPrefill> | undefined,
  requestId: number,
) {
  if (!current || current.id !== requestId || !current.prefill?.email) return current;
  return { ...current, prefill: { ...current.prefill, email: undefined } };
}
