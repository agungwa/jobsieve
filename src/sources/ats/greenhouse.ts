import type { AtsAdapter } from "../types";
import type { SourceJob } from "../../types/job";
import type { NormalizedJob } from "../../types/job";
import { SourceUnavailableError } from "../../errors";
import { finalizeJob } from "../../ingest/normalize";

/**
 * Greenhouse job board API. No auth.
 * `https://boards-api.greenhouse.io/v1/boards/{board}/jobs`
 *
 * The list endpoint has no description/salary; we keep the composite light
 * (title · company · location · seniority), which is what gets embedded.
 */

const BASE = "https://boards-api.greenhouse.io/v1/boards";

export interface GreenhouseRawJob {
  id: number | string;
  title: string;
  company_name?: string;
  location?: { name?: string };
  absolute_url?: string;
  first_published?: string;
  updated_at?: string;
  metadata?: Array<{ name?: string; value?: unknown }>;
}

export const greenhouse: AtsAdapter<GreenhouseRawJob> = {
  name: "greenhouse",
  async fetch(): Promise<SourceJob<GreenhouseRawJob>[]> {
    // The pipeline drives ATS adapters per-board via runAtsSource(); a bare
    // fetch() without a board is a programming error.
    throw new SourceUnavailableError("greenhouse adapter requires a board (use runAtsSource)", {
      source: "greenhouse",
    });
  },

  async fetchBoard(boardSlug: string, companyName: string): Promise<SourceJob<GreenhouseRawJob>[]> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(boardSlug)}/jobs`, {
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new SourceUnavailableError(
        `Greenhouse fetch failed for board '${boardSlug}': ${(err as Error).message}`,
        { source: "greenhouse", cause: err },
      );
    }
    if (!res.ok) {
      throw new SourceUnavailableError(
        `Greenhouse board '${boardSlug}' returned HTTP ${res.status}`,
        { source: "greenhouse" },
      );
    }
    const payload = (await res.json()) as { jobs?: GreenhouseRawJob[] };
    const rows = payload.jobs ?? [];
    return rows.map((raw) => ({
      source: `greenhouse:${boardSlug}`,
      sourceJobId: String(raw.id),
      raw: { ...raw, company_name: raw.company_name ?? companyName },
    }));
  },

  normalize(raw: GreenhouseRawJob): NormalizedJob {
    const location = raw.location?.name ?? null;
    return finalizeJob({
      title: raw.title,
      company: raw.company_name ?? "Unknown",
      location,
      remoteAllowed: location ? /remote/i.test(location) : null,
      description: null,
      url: raw.absolute_url ?? `https://job-boards.greenhouse.io/${raw.id}`,
      skills: [],
      postedAt: raw.first_published ? new Date(raw.first_published) : raw.updated_at ? new Date(raw.updated_at) : null,
    });
  },
};
