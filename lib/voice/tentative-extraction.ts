const EMAIL_PATTERN =
  /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i;
const OWNED_SPOKEN_EMAIL_PREFIX = /\bmy\s+e-?mail(?:\s+address)?\s+(?:is|is:|:)\s*/iu;
const SPOKEN_EMAIL_TERMINAL_SUFFIXES = new Set([
  "academy",
  "app",
  "biz",
  "co",
  "com",
  "dev",
  "edu",
  "gov",
  "info",
  "io",
  "me",
  "my",
  "net",
  "org",
  "sg",
  "test",
  "uk",
]);

/**
 * Extract an unmistakable literal address, or an explicitly owned, bounded
 * spoken form. Never infer ownership from examples or nearby prose.
 */
export function extractExplicitVisitorEmail(text: string): string | null {
  const match = EMAIL_PATTERN.exec(text);
  if (match) {
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
  }
  return extractExplicitOwnedSpokenEmail(text);
}

function extractExplicitOwnedSpokenEmail(text: string): string | null {
  const prefix = OWNED_SPOKEN_EMAIL_PREFIX.exec(text);
  if (!prefix || prefix.index === undefined) return null;
  const tokens = text
    .slice(prefix.index + prefix[0].length)
    .match(/[\p{Letter}\p{Number}]+/gu)
    ?.map((token) => token.toLowerCase());
  if (!tokens) return null;

  const atIndex = tokens.indexOf("at");
  if (atIndex < 1) return null;
  const local = joinSpokenEmailTokens(tokens.slice(0, atIndex));
  if (!local || !tokens.slice(atIndex + 1).includes("dot")) return null;

  const domainTokens = tokens.slice(atIndex + 1, atIndex + 17);
  for (let end = 2; end <= domainTokens.length; end += 1) {
    const suffix = domainTokens[end - 1];
    const next = domainTokens[end];
    if (!suffix || !SPOKEN_EMAIL_TERMINAL_SUFFIXES.has(suffix) || next === "dot" || next === "point") continue;
    const domain = joinSpokenEmailTokens(domainTokens.slice(0, end));
    const candidate = `${local}@${domain}`;
    if (isWholeEmail(candidate)) return candidate;
  }
  return null;
}

function joinSpokenEmailTokens(tokens: string[]) {
  return tokens
    .map((token) => {
      if (token === "dot" || token === "point") return ".";
      if (token === "underscore") return "_";
      if (token === "dash" || token === "hyphen") return "-";
      if (token === "plus") return "+";
      return token;
    })
    .join("");
}

function isWholeEmail(value: string) {
  const match = EMAIL_PATTERN.exec(value);
  return match?.[0] === value;
}

/**
 * Preserve a plainly stated collaboration idea when the realtime model misses
 * its capture_fields call. This is deliberately narrower than free-form
 * summarisation: a visitor must either label the idea or describe a concrete
 * action they want to take with the space. Questions and contact corrections
 * stay part of the conversation rather than becoming an invented brief.
 */
export function extractExplicitVisitorBrief(text: string): string | null {
  const source = text.trim();
  if (!source || source.length > 600 || /[?]/u.test(source)) return null;

  const labelled = /\b(?:my\s+(?:brief|idea|message)\s+(?:is|:)|i\s+have\s+an\s+idea\s+(?:for|about))\s+(.+)$/iu.exec(
    source,
  )?.[1];
  const action =
    /\b(?:i|we)\s+(?:want|would\s+like|plan|hope|are\s+looking|are\s+hoping)\s+to\s+((?:build|run|host|create|launch|explore|partner|collaborate|lease|rent|occupy|hold|organise|organize|develop|open|showcase|bring|make|deliver|support|teach|learn)\b.+)$/iu.exec(
      source,
    )?.[0];
  const candidate = labelled ?? action;
  if (!candidate) return null;

  const brief = candidate
    .replace(/[.!\s]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (brief.length < 5) return null;
  if (/\b(?:actually\s+no|scratch\s+that|forget\s+that)\b/iu.test(brief)) return null;
  // These are contact/form corrections, not partnership intent. Keeping them
  // out of the brief prevents a normal voice correction from hijacking the
  // conversation or polluting the handoff note.
  if (/\b(?:e-?mail|address|name|call\s+me|phone|number|website|url|form|voice)\b/iu.test(brief)) return null;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d[\d\s().-]{7,}\d\b/iu.test(brief)) return null;
  return brief;
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
