const EMAIL_PATTERN =
  /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i;

/**
 * Extract only an unmistakable literal address. This intentionally does not
 * interpret spoken "at"/"dot" forms or infer ownership from nearby examples.
 */
export function extractExplicitVisitorEmail(text: string): string | null {
  const match = EMAIL_PATTERN.exec(text);
  if (!match) return null;
  const email = match[0];
  const trimmed = text.trim().replace(/[.,;!?]+$/, "");
  if (trimmed.toLowerCase() === email.toLowerCase()) return email;

  const prefix = text.slice(Math.max(0, match.index - 80), match.index);
  if (/(?:(?:my\s+)?e-?mail(?:\s+address)?\s+(?:is|is:|:)|reach\s+me\s+at|contact\s+me\s+at)\s*$/i.test(prefix)) {
    return email;
  }
  return null;
}
