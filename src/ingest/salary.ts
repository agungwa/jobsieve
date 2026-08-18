/**
 * Deterministic salary string parser. Converts source-provided free-text salary
 * into a normalized (min, max, currency, period) tuple.
 *
 * Examples handled:
 *   "$120k - $140k USD"        -> {120000, 140000, "USD", "yearly"}
 *   "$100,000 - $130,000"      -> {100000, 130000, "USD", "yearly"}
 *   "£60k"                     -> {60000, null,   "GBP", "yearly"}
 *   "€70,000"                  -> {70000, null,   "EUR", "yearly"}
 *   "$50/hr"                   -> {null,  null,   "USD", "hourly"}
 *   "Competitive"              -> {null,  null,   null,  null}
 */

export interface SalaryParts {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "yearly" | "hourly" | "monthly" | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  A$: "AUD",
  C$: "CAD",
};

const PERIOD_KEYWORDS: Array<[RegExp, SalaryParts["salaryPeriod"]]> = [
  [/\b(per\s*hour|\/\s*hr\b|\/\s*hour\b|hourly)\b/i, "hourly"],
  [/\b(per\s*month|\/\s*mo\b|monthly)\b/i, "monthly"],
  [/\b(per\s*year|\/\s*yr\b|yearly|annually)\b/i, "yearly"],
];

function parseAmount(token: string): number | null {
  // Strip currency symbols and thousands separators, handle k/K suffix.
  const cleaned = token.replace(/[,$£€¥]/g, "").trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!match) return null;
  const num = parseFloat(match[1]!);
  const suffix = match[2];
  const mult = suffix === "k" || suffix === "K" ? 1_000 : suffix === "m" || suffix === "M" ? 1_000_000 : 1;
  return Math.round(num * mult);
}

export function parseSalary(input: string | null | undefined): SalaryParts {
  if (!input) return emptySalary();
  const text = input.trim();
  if (!text) return emptySalary();

  const currency =
    Object.entries(CURRENCY_SYMBOLS).find(([sym]) =>
      text.includes(sym),
    )?.[1] ??
    (text.match(/\b(USD|GBP|EUR|JPY|AUD|CAD|SGD|INR)\b/i)?.[1]?.toUpperCase() ?? null);

  const period =
    PERIOD_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? (/\d{4,}/.test(text.replace(/[^\d]/g, "")) ? "yearly" : null);

  // Range "X - Y" / "X to Y"
  const rangeMatch = text.match(/(\$?\s*[\d.,]+[kKmM]?)\s*(?:-|–|—|to)\s*(\$?\s*[\d.,]+[kKmM]?)/);
  if (rangeMatch) {
    const min = parseAmount(rangeMatch[1]!);
    const max = parseAmount(rangeMatch[2]!);
    if (min !== null && max !== null) {
      return { salaryMin: min, salaryMax: max, salaryCurrency: currency, salaryPeriod: period };
    }
  }

  // Single number
  const single = text.match(/(\$?\s*[\d.,]+[kKmM]?)/);
  if (single) {
    const amount = parseAmount(single[1]!);
    if (amount !== null) {
      return { salaryMin: amount, salaryMax: null, salaryCurrency: currency, salaryPeriod: period };
    }
  }

  return emptySalary();
}

function emptySalary(): SalaryParts {
  return { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };
}
