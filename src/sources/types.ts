import type { NormalizedJob, SourceJob } from "../types/job";

/**
 * Every source (free API or ATS) implements this. The pipeline drives
 * `fetch()` → `normalize()` for each raw record.
 *
 * Adapters MUST NOT touch the database — they are pure fetch+transform units,
 * which makes them trivial to test and isolates failures.
 */
export interface SourceAdapter<TRaw = unknown> {
  /** Stable identifier stored in `job_sources.source`. */
  readonly name: string;
  /** Fetch raw job records from the upstream API. */
  fetch(): Promise<SourceJob<TRaw>[]>;
  /** Convert one raw record into the unified shape. */
  normalize(raw: TRaw): NormalizedJob;
}

/**
 * ATS adapters iterate enabled rows from the `companies` table.
 */
export interface AtsAdapter<TRaw = unknown> extends SourceAdapter<TRaw> {
  /** Fetch all jobs for one company board. */
  fetchBoard(boardSlug: string, companyName: string): Promise<SourceJob<TRaw>[]>;
}
