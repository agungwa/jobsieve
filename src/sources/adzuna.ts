import type { SourceAdapter } from "./types";
import type { NormalizedJob, SourceJob } from "../types/job";
import { SourceUnavailableError } from "../errors";
import { config } from "../config";
import { finalizeJob, stripHtml } from "../ingest/normalize";

/**
 * Adzuna job search API. Free key at https://developer.adzuna.com.
 * Covers Australia + Singapore (the two markets we ingest; extend via
 * ADZUNA_COUNTRIES — any Adzuna country code works: au, sg, nz, in, …).
 *
 * Spec: https://developer.adzuna.com/docs/search
 * Endpoint: https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
 */

const ENDPOINT = "https://api.adzuna.com/v1/api/jobs";

/** Per-country salary currency for Adzuna's annual salary fields. */
const COUNTRY_CURRENCY: Record<string, string> = {
  au: "AUD",
  nz: "NZD",
  sg: "SGD",
  in: "INR",
  ca: "CAD",
  us: "USD",
  gb: "GBP",
  de: "EUR",
  nl: "EUR",
};

const PAGES_PER_COUNTRY = 2; // 2 × 50 = up to 100 fresh jobs per run
const RESULTS_PER_PAGE = 50;

export interface AdzunaRawJob {
  id: string | number;
  title: string;
  redirect_url: string;
  description?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  contract_time?: string;
  salary_min?: number;
  salary_max?: number;
}

export const adzuna: SourceAdapter<AdzunaRawJob> = {
  name: "adzuna",

  async fetch(): Promise<SourceJob<AdzunaRawJob>[]> {
    if (!config.ADZUNA_APP_ID || !config.ADZUNA_APP_KEY) {
      // Unset credentials simply disable the source (recorded, not fatal).
      throw new SourceUnavailableError(
        "Adzuna credentials not configured (ADZUNA_APP_ID / ADZUNA_APP_KEY)",
        { source: "adzuna" },
      );
    }

    const countries = config.ADZUNA_COUNTRIES.split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const out: SourceJob<AdzunaRawJob>[] = [];

    for (const country of countries) {
      for (let page = 1; page <= PAGES_PER_COUNTRY; page++) {
        const url =
          `${ENDPOINT}/${country}/search/${page}` +
          `?app_id=${encodeURIComponent(config.ADZUNA_APP_ID)}` +
          `&app_key=${encodeURIComponent(config.ADZUNA_APP_KEY)}` +
          `&results_per_page=${RESULTS_PER_PAGE}` +
          `&category=it-jobs`; // tech roles only — the site's focus
        let res: Response;
        try {
          res = await fetch(url, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
        } catch (err) {
          throw new SourceUnavailableError(
            `Adzuna (${country}) fetch failed: ${(err as Error).message}`,
            { source: "adzuna", cause: err },
          );
        }
        if (!res.ok) {
          throw new SourceUnavailableError(
            `Adzuna (${country}) returned HTTP ${res.status}`,
            { source: "adzuna" },
          );
        }
        const payload = (await res.json()) as { results?: AdzunaRawJob[] };
        const rows = payload.results ?? [];
        for (const raw of rows) {
          out.push({ source: "adzuna", sourceJobId: `${country}:${raw.id}`, raw });
        }
        if (rows.length < RESULTS_PER_PAGE) break; // no more pages
      }
    }
    return out;
  },

  normalize(raw: AdzunaRawJob): NormalizedJob {
    const area = raw.location?.area ?? [];
    // area is [country, state, metro, …neighbourhood] — keep city-level:
    // "Sydney Region, Australia" style, falling back to display_name.
    const place =
      area.length >= 3 ? `${area[2]}, ${area[0]}` : raw.location?.display_name ?? null;

    const hasSalary = typeof raw.salary_min === "number" || typeof raw.salary_max === "number";
    const currency =
      area.length > 0 ? COUNTRY_CURRENCY[normalizeCountry(area[0])] ?? null : null;

    return finalizeJob({
      title: raw.title,
      company: raw.company?.display_name ?? "Confidential Employer",
      location: place,
      remoteAllowed: /remote|work from home/i.test(raw.title) ? true : null,
      description: stripHtml(raw.description ?? null),
      url: raw.redirect_url,
      skills: [],
      postedAt: raw.created ? new Date(raw.created) : null,
      salary: hasSalary
        ? {
            salaryMin: raw.salary_min ?? null,
            salaryMax: raw.salary_max ?? null,
            salaryCurrency: currency,
            salaryPeriod: "yearly",
          }
        : undefined,
    });
  },
};

/** "Australia" → "au" for the currency lookup. */
function normalizeCountry(name: string | undefined): string {
  const map: Record<string, string> = {
    australia: "au",
    "new zealand": "nz",
    singapore: "sg",
    india: "in",
    canada: "ca",
    "united states": "us",
    "united kingdom": "gb",
    germany: "de",
    netherlands: "nl",
  };
  return map[(name ?? "").toLowerCase()] ?? "";
}
