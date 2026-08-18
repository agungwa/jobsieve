import type { NormalizedJob } from "../types/job";
import { parseSalary, type SalaryParts } from "./salary";

/**
 * Strip HTML tags and collapse whitespace. Most ATS sources return description
 * with HTML; we persist plain text for embedding + display.
 */
export function stripHtml(input: string | null | undefined): string | null {
  if (!input) return null;
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim() || null;
}

export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Infer a seniority bucket from a title (Junior/Mid/Senior/Staff/Principal/Director+).
 * Cheap heuristic — no AI needed.
 */
export function inferSeniority(title: string): string | null {
  const t = title.toLowerCase();
  if (/\b(intern|internship|apprentice)\b/.test(t)) return "intern";
  if (/\b(junior|jr\.?|entry|graduate)\b/.test(t)) return "junior";
  if (/\b(senior|sr\.?|lead|staff|principal|expert)\b/.test(t)) {
    if (/\b(staff|principal)\b/.test(t)) return "staff";
    if (/\b(sr\.?|senior)\b/.test(t)) return "senior";
    if (/\b(lead)\b/.test(t)) return "lead";
    return "senior";
  }
  if (/\b(manager|head of|director|vp|vice president|chief|cto|cio|ceo)\b/.test(t)) {
    if (/\b(director|vp|vice president|chief|cto|cio|ceo)\b/.test(t)) return "director+";
    return "manager";
  }
  return "mid";
}

/**
 * Build the compressed `summary` column embedded into chat context.
 * Format: "{title} · {company} · {skills} · {location} · {seniority}"
 */
export function buildJobSummary(job: NormalizedJob): string {
  const parts: string[] = [job.title, job.company];
  if (job.skills.length > 0) parts.push(job.skills.slice(0, 8).join(", "));
  if (job.location) parts.push(job.location);
  if (job.seniority) parts.push(job.seniority);
  if (job.salaryMin !== null && job.salaryMax !== null) {
    parts.push(`${job.salaryMin}-${job.salaryMax}${job.salaryCurrency ?? ""}`);
  }
  return parts.join(" · ");
}

/**
 * Convenience: apply salary parsing + HTML stripping + seniority inference to
 * an adapter's partial NormalizedJob. Used by every adapter to avoid repeating
 * the same post-processing.
 */
export function finalizeJob(
  partial: Omit<NormalizedJob, "seniority" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"> & {
    seniority?: string | null;
    salaryText?: string | null;
    salary?: SalaryParts;
    description?: string | null;
  },
): NormalizedJob {
  const salary: SalaryParts =
    partial.salary ?? parseSalary(partial.salaryText ?? null);
  const description = partial.description ?? null;
  return {
    title: partial.title,
    company: partial.company,
    location: partial.location,
    remoteAllowed: partial.remoteAllowed,
    seniority: partial.seniority ?? inferSeniority(partial.title),
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryCurrency: salary.salaryCurrency,
    salaryPeriod: salary.salaryPeriod,
    description,
    url: partial.url,
    skills: partial.skills,
    postedAt: partial.postedAt,
  };
}
