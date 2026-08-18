import type { SourceAdapter } from "./types";
import type { NormalizedJob, SourceJob } from "../types/job";
import { SourceUnavailableError } from "../errors";
import { finalizeJob, stripHtml } from "../ingest/normalize";

/**
 * Remotive public API. No auth. `https://remotive.com/api/remote-jobs`
 * (remotive.com, NOT the terminated remotive.io endpoint).
 *
 * Response: { "00-warning": ..., jobs: [...] }. The first keys are legal
 * notices — only `jobs` matters. They ask for ≤4 fetches/day and attribution
 * via the job URL, which we keep as-is.
 */

const ENDPOINT = "https://remotive.com/api/remote-jobs";

export interface RemotiveRawJob {
  id: number | string;
  url?: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string; // "2026-08-16T10:09:41"
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export const remotive: SourceAdapter<RemotiveRawJob> = {
  name: "remotive",
  async fetch(): Promise<SourceJob<RemotiveRawJob>[]> {
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}?limit=200`, {
        headers: { accept: "application/json", "user-agent": "jobs-found/0.1" },
      });
    } catch (err) {
      throw new SourceUnavailableError(`Remotive fetch failed: ${(err as Error).message}`, {
        source: "remotive",
        cause: err,
      });
    }
    if (!res.ok) {
      throw new SourceUnavailableError(`Remotive returned HTTP ${res.status}`, {
        source: "remotive",
      });
    }
    const payload = (await res.json()) as { jobs?: RemotiveRawJob[] };
    const rows = payload.jobs ?? [];
    return rows.map((raw) => ({
      source: "remotive",
      sourceJobId: String(raw.id),
      raw,
    }));
  },

  normalize(raw: RemotiveRawJob): NormalizedJob {
    return finalizeJob({
      title: raw.title,
      company: raw.company_name,
      location: raw.candidate_required_location ?? null,
      // Remotive is a remote-only board.
      remoteAllowed: true,
      description: stripHtml(raw.description ?? null),
      url: raw.url ?? "https://remotive.com/remote-jobs",
      skills: [...(raw.tags ?? []), ...(raw.category ? [raw.category] : [])].map((t) =>
        t.toLowerCase(),
      ),
      postedAt: raw.publication_date ? new Date(raw.publication_date) : null,
      salaryText: raw.salary ?? null,
    });
  },
};
