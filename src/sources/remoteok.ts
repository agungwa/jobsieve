import type { SourceAdapter } from "./types";
import type { NormalizedJob, SourceJob } from "../types/job";
import { SourceUnavailableError } from "../errors";
import { finalizeJob, stripHtml } from "../ingest/normalize";

/**
 * RemoteOK public API. No auth. `https://remoteok.com/api`
 *
 * Response is an array whose [0] element is a legal notice, not a job.
 * RemoteOK sits behind Cloudflare and frequently 403s non-browser agents;
 * every fetch is retried with exponential backoff and failures are recorded
 * in `sources.last_error` by the pipeline (best-effort source).
 */

const ENDPOINT = "https://remoteok.com/api";
const MAX_ATTEMPTS = 3;

export interface RemoteOkRawJob {
  slug?: string;
  id?: string | number;
  epoch?: number; // Unix seconds
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  location?: string;
  url?: string;
  salary_min?: number;
  salary_max?: number;
  description?: string;
}

async function fetchWithBackoff(): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    }
    try {
      const res = await fetch(ENDPOINT, {
        headers: {
          accept: "application/json",
          "user-agent": "jobs-found/0.1 (job aggregator; contact via GitHub)",
        },
      });
      if (res.ok) return res;
      // 403/429/5xx: retry with backoff.
      lastErr = new SourceUnavailableError(`RemoteOK returned HTTP ${res.status}`, {
        source: "remoteok",
      });
      if (res.status !== 403 && res.status !== 429 && res.status < 500) throw lastErr;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? new SourceUnavailableError(`RemoteOK failed after ${MAX_ATTEMPTS} attempts: ${lastErr.message}`, {
        source: "remoteok",
        cause: lastErr,
      })
    : new SourceUnavailableError("RemoteOK failed", { source: "remoteok" });
}

export const remoteok: SourceAdapter<RemoteOkRawJob> = {
  name: "remoteok",
  async fetch(): Promise<SourceJob<RemoteOkRawJob>[]> {
    const res = await fetchWithBackoff();
    const payload = (await res.json()) as RemoteOkRawJob[];
    // [0] is the legal notice — filter to records with a position + company.
    const rows = payload.filter(
      (r): r is RemoteOkRawJob => typeof r.position === "string" && typeof r.company === "string",
    );
    return rows.map((raw) => ({
      source: "remoteok",
      sourceJobId: String(raw.id ?? raw.slug ?? ""),
      raw,
    }));
  },

  normalize(raw: RemoteOkRawJob): NormalizedJob {
    const url =
      raw.url ??
      (raw.slug ? `https://remoteok.com/remote-jobs/${raw.slug}` : "https://remoteok.com");
    const salary =
      raw.salary_min != null && raw.salary_max != null
        ? `${raw.salary_min} - ${raw.salary_max}`
        : null;
    return finalizeJob({
      title: raw.position ?? "Unknown",
      company: raw.company ?? "Unknown",
      location: raw.location ?? null,
      remoteAllowed: true, // remote-only board
      description: stripHtml(raw.description ?? null),
      url,
      skills: (raw.tags ?? []).map((t) => t.toLowerCase()),
      postedAt: raw.epoch ? new Date(raw.epoch * 1000) : raw.date ? new Date(raw.date) : null,
      salaryText: salary,
    });
  },
};
