import type { NormalizedJob } from "../types/job";
import type { ParsedCV } from "../types/cv";

/**
 * Build the short, signal-rich string that gets embedded (and stored as the
 * cache key). Spec: "{title} · {company} · {skills} · {location} · {seniority}"
 *
 * Keeping this stable and short is the main lever for match quality at low
 * token cost.
 */
export function buildJobComposite(job: {
  title: string;
  company: string;
  location: string | null;
  seniority: string | null;
  skills: string[];
}): string {
  const parts: string[] = [job.title, job.company];
  if (job.skills.length > 0) parts.push(job.skills.slice(0, 8).join(", "));
  if (job.location) parts.push(job.location);
  if (job.seniority) parts.push(job.seniority);
  return parts.join(" · ");
}

/**
 * For CVs, we embed: "{target_role} · {top_skills} · {years} years · {seniority}"
 *
 * `seniority` is inferred from years: <2 intern, 2-4 junior, 4-7 mid, 7+ senior.
 */
export function buildCvComposite(cv: {
  targetRole: string | null;
  skills: Array<{ skill: string; occurrences: number }>;
  estimatedYearsExperience: number | null;
}): string {
  const topSkills = [...cv.skills]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 10)
    .map((s) => s.skill);
  const parts: string[] = [];
  if (cv.targetRole) parts.push(cv.targetRole);
  if (topSkills.length > 0) parts.push(topSkills.join(", "));
  if (cv.estimatedYearsExperience !== null) {
    parts.push(`${Math.round(cv.estimatedYearsExperience)} years`);
    parts.push(inferSeniorityFromYears(cv.estimatedYearsExperience));
  }
  return parts.join(" · ");
}

function inferSeniorityFromYears(years: number): string {
  if (years < 2) return "intern";
  if (years < 4) return "junior";
  if (years < 7) return "mid";
  if (years < 12) return "senior";
  return "staff";
}

export function buildJobCompositeFromNormalized(job: NormalizedJob): string {
  return buildJobComposite(job);
}

export function buildCvCompositeFromParsed(cv: ParsedCV): string {
  return buildCvComposite({
    targetRole: cv.targetRole,
    skills: cv.skills,
    estimatedYearsExperience: cv.estimatedYearsExperience,
  });
}
