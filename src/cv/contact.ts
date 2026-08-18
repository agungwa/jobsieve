import type { Contact } from "../types/cv";

/**
 * Regex-only contact extraction. Zero AI.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9-]{1,39}(?:\/)?/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9-_%]{3,100}(?:\/)?/i;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/;

export function extractContacts(text: string): Contact {
  // Only scan the first ~3000 chars — contacts are always at the top of a CV.
  const head = text.slice(0, 3000);

  const email = head.match(EMAIL_RE)?.[0] ?? null;

  // Phone: prefer lines that look like phone contexts to avoid matching dates.
  let phone: string | null = null;
  const phoneCandidate = head.match(PHONE_RE)?.[0];
  if (phoneCandidate) {
    const digits = phoneCandidate.replace(/\D/g, "");
    // Heuristic: 8-15 digits, not starting with 19/20 (looks like a year).
    if (digits.length >= 8 && digits.length <= 15 && !/^(19|20)\d{6}$/.test(digits)) {
      phone = phoneCandidate.trim();
    }
  }

  const github = text.match(GITHUB_RE)?.[0] ?? null;
  const linkedin = text.match(LINKEDIN_RE)?.[0] ?? null;

  // Personal URL: any http(s) URL that isn't github/linkedin/email-provider.
  let url: string | null = null;
  const urlMatch = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (urlMatch) {
    const candidate = urlMatch[0]!;
    if (
      !/github\.com|linkedin\.com|mailto:|\.png|\.jpe?g/i.test(candidate)
    ) {
      url = candidate;
    }
  }

  return { email, phone, github, linkedin, url };
}
