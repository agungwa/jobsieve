import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { jobs, jobSkills, jobSources, sources, companies } from "../db/schema";
import { buildJobSummary, stripHtml } from "./normalize";
import { computeContentHash } from "./dedupe";
import type { AtsAdapter, SourceAdapter } from "../sources/types";
import type { SourceJob } from "../types/job";
import type { NormalizedJob } from "../types/job";
import { sourceStatusEnum } from "../db/schema";

/**
 * Persist a batch of raw records through normalize → dedupe → upsert.
 * Shared by runSource and runAtsSource.
 */
async function persistRecords(
  adapter: SourceAdapter,
  records: SourceJob<never>[],
  hqLocation: string | null = null,
): Promise<void> {
  const db = await getDb();
  for (const record of records) {
    let normalized: NormalizedJob;
    try {
      normalized = adapter.normalize(record.raw);
    } catch (err) {
      // Per-record normalize failure: skip, don't kill the whole batch.
      console.warn(
        `[ingest:${adapter.name}] normalize failed for source id ${record.sourceJobId}:`,
        (err as Error).message,
      );
      continue;
    }
    const contentHash = computeContentHash(normalized);
    const summary = buildJobSummary(normalized);
    // Defense-in-depth: descriptions must be plain text no matter what an
    // adapter returned.
    normalized = { ...normalized, description: stripHtml(normalized.description) };

    // HQ enrichment: some boards publish a generic location ("Hybrid",
    // "Remote") with no geography — append the company HQ so the job is
    // findable by country/city.
    if (hqLocation && (/^(remote|hybrid|onsite)$/i.test(normalized.location ?? "") || !normalized.location)) {
      normalized = {
        ...normalized,
        location: normalized.location
          ? `${normalized.location} · ${hqLocation}`
          : hqLocation,
      };
    }

    const result = await db
      .insert(jobs)
      .values({
        contentHash,
        title: normalized.title,
        company: normalized.company,
        location: normalized.location,
        remoteAllowed: normalized.remoteAllowed === null ? null : normalized.remoteAllowed ? 1 : 0,
        seniority: normalized.seniority,
        salaryMin: normalized.salaryMin,
        salaryMax: normalized.salaryMax,
        salaryCurrency: normalized.salaryCurrency,
        salaryPeriod: normalized.salaryPeriod,
        description: normalized.description,
        summary,
        url: normalized.url,
        embeddingStatus: "pending",
        postedAt: normalized.postedAt,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: jobs.contentHash,
        set: {
          // Re-seen: bump lastSeenAt + refresh transient fields.
          lastSeenAt: new Date(),
          location: normalized.location,
          description: normalized.description,
          summary,
          postedAt: normalized.postedAt ?? sql`${jobs.postedAt}`,
        },
      })
      .returning({ id: jobs.id });

    const jobId = result[0]!.id;

    // Track the source link (idempotent).
    await db
      .insert(jobSources)
      .values({
        jobId,
        source: record.source,
        sourceJobId: record.sourceJobId,
      })
      .onConflictDoNothing();

    // Refresh skills (delete + reinsert — small array). Dedupe first: the
    // (job_id, skill) PK rejects duplicate matches within one insert batch.
    const uniqueSkills = [...new Set(normalized.skills)];
    if (uniqueSkills.length > 0) {
      await db.delete(jobSkills).where(sql`${jobSkills.jobId} = ${jobId}`);
      await db.insert(jobSkills).values(
        uniqueSkills.map((skill) => ({ jobId, skill })),
      );
    }
  }
}

/**
 * Run one source adapter end-to-end:
 *   fetch → normalize → dedupe → persist with embedding_status='pending'
 *
 * Isolation: any adapter-level error is caught and recorded in `sources`;
 * sibling sources continue. Never throws.
 */
export async function runSource(adapter: SourceAdapter): Promise<{
  fetched: number;
  inserted: number;
  updated: number;
  error: string | null;
}> {
  const db = await getDb();
  let fetched = 0;
  let error: string | null = null;

  try {
    const records = await adapter.fetch();
    fetched = records.length;
    await persistRecords(adapter, records as SourceJob<never>[]);
  } catch (err) {
    error = (err as Error).message;
    console.error(`[ingest:${adapter.name}] pipeline error:`, error);
  }

  // Update source run metadata.
  const embeddingPendingCount = await getEmbeddingPendingCount();
  await db
    .insert(sources)
    .values({
      name: adapter.name,
      lastRunAt: new Date(),
      lastStatus: error ? "error" : "ok",
      lastError: error,
      jobsFetched: fetched,
      embeddingPendingCount,
    })
    .onConflictDoUpdate({
      target: sources.name,
      set: {
        lastRunAt: new Date(),
        lastStatus: error ? sourceStatusEnum.enumValues[1] : sourceStatusEnum.enumValues[0],
        lastError: error,
        jobsFetched: fetched,
        embeddingPendingCount,
      },
    });

  return { fetched, inserted: 0, updated: 0, error };
}

/**
 * Run one ATS adapter across every enabled company board of its type.
 * Per-board failures are isolated (a dead board doesn't kill the others)
 * and recorded in `sources.last_error`.
 */
export async function runAtsSource(adapter: AtsAdapter): Promise<{
  boards: number;
  fetched: number;
  error: string | null;
}> {
  const db = await getDb();
  const boardRows = await db
    .select({ name: companies.name, boardSlug: companies.boardSlug, hqLocation: companies.hqLocation })
    .from(companies)
    .where(
      sql`${companies.atsType} = ${adapter.name} AND ${companies.enabled} = 1`,
    );

  let fetched = 0;
  const boardErrors: string[] = [];

  for (const board of boardRows) {
    try {
      const records = await adapter.fetchBoard(board.boardSlug, board.name);
      fetched += records.length;
      await persistRecords(adapter, records as SourceJob<never>[], board.hqLocation);
    } catch (err) {
      boardErrors.push(`${board.boardSlug}: ${(err as Error).message}`);
      console.error(`[ingest:${adapter.name}] board '${board.boardSlug}' failed:`, (err as Error).message);
    }
  }

  const error = boardErrors.length > 0 ? boardErrors.join("; ").slice(0, 1000) : null;
  const embeddingPendingCount = await getEmbeddingPendingCount();
  await db
    .insert(sources)
    .values({
      name: adapter.name,
      lastRunAt: new Date(),
      lastStatus: error ? "error" : "ok",
      lastError: error,
      jobsFetched: fetched,
      embeddingPendingCount,
    })
    .onConflictDoUpdate({
      target: sources.name,
      set: {
        lastRunAt: new Date(),
        lastStatus: error ? sourceStatusEnum.enumValues[1] : sourceStatusEnum.enumValues[0],
        lastError: error,
        jobsFetched: fetched,
        embeddingPendingCount,
      },
    });

  return { boards: boardRows.length, fetched, error };
}

async function getEmbeddingPendingCount(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(sql`${jobs.embeddingStatus} = 'pending'`);
  return rows[0]?.count ?? 0;
}
