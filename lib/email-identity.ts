import { normalizeStoredEmail } from "@/lib/data-payload";

const localPartPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const topLevelDomainPattern = /^[a-z]{2,63}$/;

/**
 * Returns a conservative canonical identity key, or an empty string when an
 * address is not strong enough to authorize cross-conversation inference.
 * This deliberately rejects valid-but-unusual internationalized addresses:
 * a false negative keeps two calls separate, while a false positive can join
 * two customers' records.
 */
export function canonicalEmailIdentityKey(value: string | null | undefined) {
  if (!value || containsWhitespaceOrControl(value)) return "";
  const email = normalizeStoredEmail(value);
  if (email !== value || email.length < 3 || email.length > 180) return "";

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !localPartPattern.test(local) ||
    domain.length > 253 ||
    domain.includes("..")
  ) {
    return "";
  }

  const labels = domain.split(".");
  const topLevelDomain = labels[labels.length - 1] ?? "";
  if (
    labels.length < 2 ||
    !labels.every((label) => domainLabelPattern.test(label)) ||
    !topLevelDomainPattern.test(topLevelDomain)
  ) {
    return "";
  }
  return email;
}

function containsWhitespaceOrControl(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f || character.trim() === "";
  });
}
