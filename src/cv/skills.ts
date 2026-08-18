import AhoCorasick from "aho-corasick";
import type { SkillMatch } from "../types/cv";
import dictionary from "../../data/skills.json";

/**
 * Skills extraction via Aho-Corasick multi-pattern matching. Zero AI.
 *
 * One pass over the CV text finds all occurrences of every skill and alias in
 * the dictionary (O(text + matches)), then aliases collapse to canonical names
 * with occurrence counts.
 */

interface DictionaryEntry {
  canonical: string;
  aliases: string[];
}

const entries = dictionary.skills as DictionaryEntry[];

// Build term -> canonical map. Terms are matched case-insensitively with
// word boundaries enforced post-hoc (Aho-Corasick matches substrings).
const termToCanonical = new Map<string, string>();
for (const entry of entries) {
  const terms = [entry.canonical, ...entry.aliases];
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (!termToCanonical.has(lower)) {
      termToCanonical.set(lower, entry.canonical);
    }
  }
}

// Lazy-build the automaton on first use (~50ms for ~500 patterns).
let _matcher: AhoCorasick | null = null;
function getMatcher(): AhoCorasick {
  if (!_matcher) {
    const matcher = new AhoCorasick();
    for (const term of termToCanonical.keys()) {
      matcher.add(term, term);
    }
    matcher.build_fail();
    _matcher = matcher;
  }
  return _matcher;
}

/** Check that a match at [start, end) aligns with word boundaries. */
function hasWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1]! : " ";
  const after = end < text.length ? text[end]! : " ";
  // Allow adjacency to C++, C#, .NET etc.
  const isWordChar = (ch: string) => /[a-zA-Z0-9+#.]/.test(ch);
  // For terms containing symbols like c++/c#, we relax left boundary.
  const matchText = text.slice(start, end);
  if (/[+#]$/.test(matchText)) return !/\w/.test(before) || before === " ";
  return !isWordChar(before) && !isWordChar(after);
}

export function extractSkills(text: string): SkillMatch[] {
  const matcher = getMatcher();
  const lower = text.toLowerCase();

  const byCanonical = new Map<string, SkillMatch>();
  matcher.search(lower, (term: string, _data: unknown, start: number) => {
    const canonical = termToCanonical.get(term);
    if (!canonical) return;
    if (!hasWordBoundary(lower, start, start + term.length)) return;
    const existing = byCanonical.get(canonical);
    if (existing) {
      existing.occurrences++;
    } else {
      byCanonical.set(canonical, {
        skill: canonical,
        occurrences: 1,
        firstPosition: start,
      });
    }
  });

  return [...byCanonical.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.firstPosition - b.firstPosition,
  );
}

export function canonicalizeSkill(input: string): string {
  const lower = input.toLowerCase().trim();
  return termToCanonical.get(lower) ?? input;
}
