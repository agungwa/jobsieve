import type { AtsAdapter } from "../types";
import type { SourceJob } from "../../types/job";
import type { NormalizedJob } from "../../types/job";
import { SourceUnavailableError } from "../../errors";
import { finalizeJob } from "../../ingest/normalize";

/**
 * Lever postings API. No auth.
 * `https://api.lever.co/v0/postings/{company}?mode=json`
 *
 * `createdAt` is Unix milliseconds. `text` is the job title (yes, really).
 */

const BASE = "https://api.lever.co/v0/postings";

export interface LeverRawJob {
  id: string;
  company?: string; // injected by fetchBoard from the companies table
  text?: string; // job title
  hostedUrl?: string;
  createdAt?: number; // epoch ms
  categories?: {
    location?: string;
    commitment?: string;
    department?: string;
    team?: string;
  };
  descriptionPlain?: string;
  descriptionBody?: string;
  lists?: Array<{ text?: string; content?: string }>;
}

export const lever: AtsAdapter<LeverRawJob> = {
  name: "lever",
  async fetch(): Promise<SourceJob<LeverRawJob>[]> {
    throw new SourceUnavailableError("lever adapter requires a board (use runAtsSource)", {
      source: "lever",
    });
  },

  async fetchBoard(boardSlug: string, companyName: string): Promise<SourceJob<LeverRawJob>[]> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(boardSlug)}?mode=json`, {
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new SourceUnavailableError(
        `Lever fetch failed for board '${boardSlug}': ${(err as Error).message}`,
        { source: "lever", cause: err },
      );
    }
    if (!res.ok) {
      throw new SourceUnavailableError(
        `Lever board '${boardSlug}' returned HTTP ${res.status}`,
        { source: "lever" },
      );
    }
    const rows = (await res.json()) as LeverRawJob[];
    if (!Array.isArray(rows)) {
      throw new SourceUnavailableError(
        `Lever board '${boardSlug}' returned non-array payload (likely not a board)`,
        { source: "lever" },
      );
    }
    return rows.map((raw) => ({
      source: `lever:${boardSlug}`,
      sourceJobId: String(raw.id),
      raw: { ...raw, company: companyName },
    }));
  },

  normalize(raw: LeverRawJob): NormalizedJob {
    const location = raw.categories?.location ?? null;
    return finalizeJob({
      title: raw.text ?? "Unknown",
      company: raw.company ?? "Unknown",
      location,
      remoteAllowed: location ? /remote/i.test(location) : null,
      description: raw.descriptionPlain ?? null,
      url: raw.hostedUrl ?? `https://jobs.lever.co/${raw.id}`,
      skills: [],
      postedAt: raw.createdAt ? new Date(raw.createdAt) : null,
    });
  },
};
