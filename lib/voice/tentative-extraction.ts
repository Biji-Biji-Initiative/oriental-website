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
  if (
    /(?:(?:my\s+)?e-?mail(?:\s+address)?\s+(?:is|is:|:)|reach\s+me\s+at|contact\s+me\s+at|\bi\s+(?:want|need|would\s+like)\s+to\s+(?:use\s+(?:my\s+)?voice\s+to\s+)?(?:give|share|say|use|do)\s+(?:the\s+|my\s+)?e-?mail(?:\s+address)?)\s*$/i.test(
      prefix,
    )
  ) {
    return email;
  }
  return null;
}

/**
 * A visitor spelling a name is direct correction authority. Only accept a
 * bounded run of individually spoken letters after an explicit name cue; this
 * avoids treating ordinary prose as a name while preserving the exact intent.
 */
export function extractExplicitSpelledVisitorName(text: string): string | null {
  const letterRun = "((?:[A-Za-z](?:[\\s-]+|(?=[.!?]|$))){2,})";
  const cues = [
    new RegExp(`\\b(?:my\\s+name\\s+is|name\\s+is|call\\s+me)\\s+${letterRun}`, "iu"),
    new RegExp(`\\b[A-Za-z][A-Za-z'’-]{1,59}\\s+is\\s+(?:spelled\\s+)?${letterRun}`, "iu"),
  ];
  const spelled = cues.map((pattern) => pattern.exec(text)?.[1]).find(Boolean);
  if (!spelled) return null;

  const letters = spelled.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || letters.length > 60) return null;
  return `${letters[0]?.toUpperCase()}${letters.slice(1).toLowerCase()}`;
}
