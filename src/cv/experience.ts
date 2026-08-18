import type { Section } from "../types/cv";

/**
 * Years-of-experience estimation. Zero AI.
 *
 * Scans the experience section for date ranges like:
 *   "Jan 2020 - Dec 2023", "2020 - 2023", "Mar 2018 - Present",
 *   "03/2020–08/2022"
 * Sums the (non-overlapping-approximated) spans.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

interface Span { start: number; end: number } // epoch ms

function parseDate(token: string, now: number): number | null {
  const t = token.trim();

  // "Present" / "Current" / "Now"
  if (/^(present|current|now|today)$/i.test(t)) return now;

  // Month Year: "Jan 2020", "January 2020"
  const monthYear = t.match(/^([a-zA-Z]{3,9})\.?\s+(\d{4})$/);
  if (monthYear) {
    const monthIdx = MONTHS[monthYear[1]!.slice(0, 3).toLowerCase()];
    if (monthIdx !== undefined) {
      return new Date(Date.UTC(Number(monthYear[2]), monthIdx, 1)).getTime();
    }
    return null;
  }

  // Year only: "2020"
  const yearOnly = t.match(/^(\d{4})$/);
  if (yearOnly) {
    return new Date(Date.UTC(Number(yearOnly[1]), 0, 1)).getTime();
  }

  // MM/YYYY
  const monthNum = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (monthNum) {
    const m = Number(monthNum[1]) - 1;
    if (m >= 0 && m <= 11) {
      return new Date(Date.UTC(Number(monthNum[2]), m, 1)).getTime();
    }
  }
  return null;
}

const DATE_TOKEN = String.raw`(?:[a-zA-Z]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|present|current|now|today)`;
const RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:-|–|—|to|until|through)\\s*(${DATE_TOKEN})`,
  "gi",
);

export function estimateYearsExperience(sections: Section[]): number | null {
  const now = Date.now();
  const experienceSections = sections.filter((s) =>
    ["experience", "employment", "work-history", "career-history"].includes(s.name),
  );
  if (experienceSections.length === 0) return null;

  const spans: Span[] = [];
  for (const section of experienceSections) {
    const text = section.lines.join("\n");
    for (const match of text.matchAll(RANGE_RE)) {
      const start = parseDate(match[1]!, now);
      const end = parseDate(match[2]!, now);
      if (start !== null && end !== null && end > start) {
        // Sanity: skip absurd spans (>40 years is likely a parse artifact).
        const years = (end - start) / (365.25 * 86_400_000);
        if (years > 0 && years <= 40) {
          spans.push({ start, end });
        }
      }
    }
  }

  if (spans.length === 0) return null;

  // Merge overlapping spans, then sum.
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const totalMs = merged.reduce((acc, s) => acc + (s.end - s.start), 0);
  return Math.round((totalMs / (365.25 * 86_400_000)) * 10) / 10;
}

/**
 * Guess a target role from the most frequent job title in the experience
 * section (or the first line). Zero AI — pure heuristics.
 */
export function guessTargetRole(sections: Section[], rawText: string): string | null {
  // 1. Look for an explicit "Target Role"/"Objective" statement.
  const summary = sections.find((s) => s.name === "summary");
  if (summary) {
    for (const line of summary.lines) {
      const m = line.match(/(?:target(?:ing)?(?:\s+role)?|seeking(?:\s+a)?)\s+(?:as\s+|a\s+|an\s+)?([A-Za-z][\w\s/&-]{2,60})/i);
      if (m) {
        const cleaned = m[1]!.trim().replace(/\s+/g, " ").replace(/\s+roles?$/i, "");
        if (cleaned.length >= 3) return cleaned;
      }
    }
  }
  // 2. Fall back: the first non-empty line of the header is often the name;
  //    the second is often the current title.
  const header = sections.find((s) => s.name === "header");
  if (header) {
    const nonEmpty = header.lines.filter((l) => l.trim().length > 2);
    // Heuristic: a line containing typical title keywords.
    const titleLine = nonEmpty.find((l) =>
      /\b(engineer|developer|manager|designer|analyst|scientist|architect|consultant|specialist|lead|director)\b/i.test(l),
    );
    if (titleLine) return titleLine.trim().replace(/\s+/g, " ").slice(0, 80);
  }
  // 3. Last resort: scan the first 500 chars of raw text.
  const head = rawText.slice(0, 500);
  const m = head.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Engineer|Developer|Manager|Designer))\b/);
  return m ? m[1]! : null;
}
