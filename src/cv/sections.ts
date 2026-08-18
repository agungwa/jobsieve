import type { Section } from "../types/cv";

/**
 * Heading-based section splitter. Zero AI.
 *
 * Recognizes common CV headings (with tolerance for colons, casing, and
 * decorative prefixes like "—" or bullets).
 */

const HEADING_MAP: Array<[RegExp, string]> = [
  [/^(?:professional\s+)?(?:work\s+|employment\s+)?experience\b/i, "experience"],
  [/^(?:professional\s+)?experience\b/i, "experience"],
  [/^employment(?:\s+history)?\b/i, "experience"],
  [/^work\s+history\b/i, "experience"],
  [/^career\s+(?:history|summary)\b/i, "experience"],
  [/^education(?:al)?(?:\s+background|\s+history)?\b/i, "education"],
  [/^(?:technical\s+)?skills?(?:\s+(?:&|and)\s+\w+)?\b/i, "skills"],
  [/^(?:core|key)\s+competenc(?:y|ies)\b/i, "skills"],
  [/^projects?(?:\s+(?:&|and)\s+\w+)?\b/i, "projects"],
  [/^(?:professional\s+)?summary\b/i, "summary"],
  [/^(?:profile|objective|about\s+me)\b/i, "summary"],
  [/^certifications?\b/i, "certifications"],
  [/^languages\b/i, "languages"],
  [/^publications?\b/i, "publications"],
  [/^awards?(?:\s+(?:&|and)\s+honors)?\b/i, "awards"],
  [/^volunteer(?:ing)?(?:\s+experience)?\b/i, "volunteer"],
  [/^interests?\b/i, "interests"],
  [/^references?\b/i, "references"],
];

/**
 * A heading line is typically short (< 60 chars), has no trailing period,
 * and either matches a known phrase, is followed by a colon, or is ALL CAPS.
 */
function isHeading(line: string): { canonical: string; raw: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return null;
  if (/[.,;]$/.test(trimmed) && !/:$/.test(trimmed)) return null;

  // Strip a trailing colon for matching.
  const bare = trimmed.replace(/:\s*$/, "").replace(/^[-–—•·*]\s*/, "").trim();
  if (!bare) return null;

  for (const [re, canonical] of HEADING_MAP) {
    if (re.test(bare)) {
      return { canonical, raw: trimmed };
    }
  }
  // ALL-CAPS short line that isn't a known heading — treat as custom section.
  // (Avoids classifying SHOUTED sentences: require ≤ 5 words.)
  const words = bare.split(/\s+/);
  if (
    bare.length > 2 &&
    bare === bare.toUpperCase() &&
    /[A-Z]/.test(bare) &&
    words.length <= 5
  ) {
    return { canonical: bare.toLowerCase().replace(/\s+/g, "-"), raw: trimmed };
  }
  return null;
}

export function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  let preamble: string[] = [];

  for (const line of lines) {
    const heading = isHeading(line);
    if (heading) {
      if (current) sections.push(current);
      current = { name: heading.canonical, heading: heading.raw, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);

  // The preamble (before any heading) often contains the name + summary.
  const preambleText = preamble.join("\n").trim();
  if (preambleText.length > 0) {
    sections.unshift({
      name: "header",
      heading: "(header)",
      lines: preamble.filter((l) => l.trim().length > 0),
    });
  }

  // Trim trailing empty lines from each section.
  for (const s of sections) {
    while (s.lines.length > 0 && s.lines[s.lines.length - 1]!.trim() === "") {
      s.lines.pop();
    }
  }

  return sections.filter((s) => s.lines.length > 0 || s.name === "header");
}

export function getSection(sections: Section[], name: string): Section | null {
  return sections.find((s) => s.name === name) ?? null;
}
