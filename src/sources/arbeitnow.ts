import type { SourceAdapter } from "./types";
import type { NormalizedJob, SourceJob } from "../types/job";
import { SourceUnavailableError } from "../errors";
import { finalizeJob, stripHtml } from "../ingest/normalize";

/**
 * Arbeitnow public API. No auth. Returns `{ data: [...jobs], ...meta }`.
 *
 * Spec: https://www.arbeitnow.com/blog/job-board-api
 * Endpoint observed: https://www.arbeitnow.com/api/job-board-api/jobs
 */

const ENDPOINT = "https://www.arbeitnow.com/api/job-board-api";

/**
 * Arbeitnow sends `created_at` as Unix seconds (e.g. 1786516800). JS's
 * `new Date(number)` expects milliseconds, so detect and convert.
 */
function parseArbeitnowDate(input: unknown): Date | null {
  if (typeof input === "number") {
    return new Date(input < 1e12 ? input * 1000 : input);
  }
  if (typeof input === "string") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface ArbeitnowRawJob {
  id: number | string;
  title: string;
  company_name: string;
  company_slug?: string;
  location?: string;
  remote?: boolean;
  description?: string;
  url?: string;
  slug?: string;
  tags?: string[];
  job_types?: string[];
  created_at?: string;
  salary?: string;
}

export const arbeitnow: SourceAdapter<ArbeitnowRawJob> = {
  name: "arbeitnow",
  async fetch(): Promise<SourceJob<ArbeitnowRawJob>[]> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        headers: { accept: "application/json", "user-agent": "jobs-found/0.1" },
      });
    } catch (err) {
      throw new SourceUnavailableError(`Arbeitnow fetch failed: ${(err as Error).message}`, {
        source: "arbeitnow",
        cause: err,
      });
    }
    if (!res.ok) {
      throw new SourceUnavailableError(`Arbeitnow returned HTTP ${res.status}`, {
        source: "arbeitnow",
      });
    }
    const payload = (await res.json()) as { data?: ArbeitnowRawJob[] };
    const rows = payload.data ?? [];
    return rows.map((raw) => ({
      source: "arbeitnow",
      sourceJobId: String(raw.id),
      raw,
    }));
  },

  normalize(raw: ArbeitnowRawJob): NormalizedJob {
    const url =
      raw.url ??
      (raw.company_slug && raw.slug
        ? `https://www.arbeitnow.com/jobs/${raw.company_slug}/${raw.slug}`
        : "https://www.arbeitnow.com");
    return finalizeJob({
      title: raw.title,
      company: raw.company_name,
      location: raw.location ?? null,
      remoteAllowed: raw.remote ?? null,
      description: stripHtml(raw.description ?? null),
      url,
      skills: (raw.tags ?? []).map((t) => t.toLowerCase()),
      postedAt: raw.created_at ? parseArbeitnowDate(raw.created_at) : null,
      salaryText: raw.salary ?? null,
    });
  },
};
