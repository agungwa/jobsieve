/**
 * The unified Job shape that every source adapter normalizes to.
 * Persisted in the `jobs` table.
 */
export interface NormalizedJob {
  title: string;
  company: string;
  location: string | null;
  remoteAllowed: boolean | null;
  seniority: string | null;

  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "yearly" | "hourly" | "monthly" | null;

  description: string | null;
  url: string;

  skills: string[]; // canonical skill names
  postedAt: Date | null;
}

/**
 * The shape returned by a `SourceAdapter.fetch()`. Source-native; the adapter's
 * `normalize()` method converts this to `NormalizedJob`.
 */
export interface SourceJob<TRaw = unknown> {
  source: string;
  sourceJobId: string;
  raw: TRaw;
}

/**
 * A fully-persisted job row, including generated fields.
 */
export interface Job extends NormalizedJob {
  id: string;
  contentHash: string;
  summary: string;
  fetchedAt: Date;
  lastSeenAt: Date;
  embeddingStatus: "pending" | "embedded" | "failed";
}

export type EmbeddingStatus = Job["embeddingStatus"];
