import type { AtsAdapter } from "../types";
import type { SourceJob } from "../../types/job";
import type { NormalizedJob } from "../../types/job";
import { SourceUnavailableError } from "../../errors";
import { finalizeJob } from "../../ingest/normalize";

/**
 * Ashby public posting API. No auth.
 * `https://api.ashbyhq.com/posting-api/job-board/{board}`
 *
 * Response: { jobs: [...] } with isRemote, publishedAt (ISO), jobUrl,
 * descriptionPlain.
 */

const BASE = "https://api.ashbyhq.com/posting-api/job-board";

export interface AshbyRawJob {
  id: string;
  title: string;
  company?: string; // injected by fetchBoard from the companies table
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

export const ashby: AtsAdapter<AshbyRawJob> = {
  name: "ashby",
  async fetch(): Promise<SourceJob<AshbyRawJob>[]> {
    throw new SourceUnavailableError("ashby adapter requires a board (use runAtsSource)", {
      source: "ashby",
    });
  },

  async fetchBoard(boardSlug: string, companyName: string): Promise<SourceJob<AshbyRawJob>[]> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(boardSlug)}`, {
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new SourceUnavailableError(
        `Ashby fetch failed for board '${boardSlug}': ${(err as Error).message}`,
        { source: "ashby", cause: err },
      );
    }
    if (!res.ok) {
      throw new SourceUnavailableError(
        `Ashby board '${boardSlug}' returned HTTP ${res.status}`,
        { source: "ashby" },
      );
    }
    const payload = (await res.json()) as { jobs?: AshbyRawJob[] };
    const rows = payload.jobs ?? [];
    return rows.map((raw) => ({
      source: `ashby:${boardSlug}`,
      sourceJobId: String(raw.id),
      raw: { ...raw, company: raw.company ?? companyName },
    }));
  },

  normalize(raw: AshbyRawJob): NormalizedJob {
    return finalizeJob({
      title: raw.title,
      company: raw.company ?? "Unknown",
      location: raw.location ?? null,
      remoteAllowed: raw.isRemote ?? (raw.location ? /remote/i.test(raw.location) : null),
      description: raw.descriptionPlain ?? null,
      url: raw.jobUrl ?? raw.applyUrl ?? `https://jobs.ashbyhq.com/${raw.id}`,
      skills: [],
      postedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
    });
  },
};
