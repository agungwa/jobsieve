import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { embeddingCache, jobs, cvProfiles, jobSkills } from "../db/schema";
import { config } from "../config";
import { embedBatch } from "../vector/embed";
import { buildJobCompositeFromNormalized, buildCvCompositeFromParsed } from "../vector/composite";
import type { NormalizedJob } from "../types/job";
import type { ParsedCV } from "../types/cv";
import { EmbeddingFailedError } from "../errors";

interface Candidate {
  kind: "job" | "cv";
  id: string;
  text: string;
  hash: string;
}

/**
 * One embedding tick. Pulls pending (or retryable-failed) rows across both
 * jobs and CVs, uses embedding_cache to skip the API for already-seen
 * composite text, batches the rest through GLM, and writes vectors back.
 */
export async function runEmbeddingTick(): Promise<{
  processed: number;
  embedded: number;
  cached: number;
  failed: number;
}> {
  const db = await getDb();
  const now = new Date();

  // Pick pending jobs with skills joined in.
  const jobRows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      seniority: jobs.seniority,
      embeddingStatus: jobs.embeddingStatus,
    })
    .from(jobs)
    .where(
      sql`${jobs.embeddingStatus} = 'pending' OR (${jobs.embeddingStatus} = 'failed' AND ${jobs.embeddingRetryCount} < ${config.EMBEDDING_MAX_RETRIES})`,
    )
    .limit(config.EMBEDDING_BATCH);

  // Fetch skills for those job ids.
  const jobSkillRows = jobRows.length
    ? await db
        .select({ jobId: jobSkills.jobId, skill: jobSkills.skill })
        .from(jobSkills)
        .where(inArray(jobSkills.jobId, jobRows.map((r) => r.id)))
    : [];
  const skillsByJob = new Map<string, string[]>();
  for (const r of jobSkillRows) {
    const list = skillsByJob.get(r.jobId) ?? [];
    list.push(r.skill);
    skillsByJob.set(r.jobId, list);
  }

  const cvRows = await db
    .select({
      id: cvProfiles.id,
      rawText: cvProfiles.rawText,
      contacts: cvProfiles.contacts,
      sections: cvProfiles.sections,
      skills: cvProfiles.skills,
      estimatedYearsExperience: cvProfiles.estimatedYearsExperience,
      targetRole: cvProfiles.targetRole,
    })
    .from(cvProfiles)
    .where(
      sql`${cvProfiles.embeddingStatus} = 'pending' OR (${cvProfiles.embeddingStatus} = 'failed' AND ${cvProfiles.embeddingRetryCount} < ${config.EMBEDDING_MAX_RETRIES})`,
    )
    .limit(config.EMBEDDING_BATCH);

  if (jobRows.length === 0 && cvRows.length === 0) {
    return { processed: 0, embedded: 0, cached: 0, failed: 0 };
  }

  const candidates: Candidate[] = [];

  for (const row of jobRows) {
    const normalized: NormalizedJob = {
      title: row.title,
      company: row.company,
      location: row.location,
      remoteAllowed: null,
      seniority: row.seniority,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      description: null,
      url: "",
      skills: skillsByJob.get(row.id) ?? [],
      postedAt: null,
    };
    const text = buildJobCompositeFromNormalized(normalized);
    candidates.push({ kind: "job", id: row.id, text, hash: sha256(text) });
  }

  for (const row of cvRows) {
    const parsed: ParsedCV = {
      rawText: row.rawText,
      contacts: row.contacts as ParsedCV["contacts"],
      sections: row.sections as ParsedCV["sections"],
      skills: row.skills as ParsedCV["skills"],
      estimatedYearsExperience: row.estimatedYearsExperience,
      targetRole: row.targetRole,
    };
    const text = buildCvCompositeFromParsed(parsed);
    candidates.push({ kind: "cv", id: row.id, text, hash: sha256(text) });
  }

  // 1. Check cache for all candidate hashes.
  const hashes = candidates.map((c) => c.hash);
  const cacheRows = hashes.length
    ? await db
        .select({ contentHash: embeddingCache.contentHash, embedding: embeddingCache.embedding })
        .from(embeddingCache)
        .where(inArray(embeddingCache.contentHash, hashes))
    : [];
  const cacheMap = new Map(cacheRows.map((r) => [r.contentHash, r.embedding]));

  const toApi: Candidate[] = [];
  const toStore: Array<{ candidate: Candidate; vector: string }> = [];
  let cached = 0;
  for (const c of candidates) {
    const hit = cacheMap.get(c.hash);
    if (hit !== undefined) {
      toStore.push({ candidate: c, vector: hit as unknown as string });
      cached++;
    } else {
      toApi.push(c);
    }
  }

  // 2. Call API for cache misses.
  let embedded = 0;
  let failed = 0;
  if (toApi.length > 0) {
    try {
      const vectors = await embedBatch(toApi.map((c) => c.text));
      for (let i = 0; i < toApi.length; i++) {
        const vec = vectors[i]!;
        toStore.push({ candidate: toApi[i]!, vector: pgVectorLiteral(vec) });
      }
      // Persist new entries into embedding_cache.
      await db
        .insert(embeddingCache)
        .values(
          toApi.map((c, i) => ({
            contentHash: c.hash,
            embedding: pgVectorLiteral(vectors[i]!) as unknown as never,
            model: config.EMBEDDING_MODEL,
            dim: config.EMBEDDING_DIM,
          })),
        )
        .onConflictDoNothing();
    } catch (err) {
      failed = toApi.length;
      const retryable = err instanceof EmbeddingFailedError;
      console.error(
        `[embedding-worker] batch failed (${toApi.length} candidates):`,
        (err as Error).message,
      );
      for (const c of toApi) {
        await markFailed(c, retryable, now);
      }
      // Still store cache hits below.
    }
  }

  // 3. Write vectors back.
  for (const { candidate, vector } of toStore) {
    try {
      if (candidate.kind === "job") {
        await db
          .update(jobs)
          .set({
            embedding: vector as unknown as never,
            embeddingStatus: "embedded",
            embeddingLastAttemptAt: now,
            updatedAt: now,
          })
          .where(eq(jobs.id, candidate.id));
      } else {
        await db
          .update(cvProfiles)
          .set({
            embedding: vector as unknown as never,
            embeddingStatus: "embedded",
            embeddingLastAttemptAt: now,
            updatedAt: now,
          })
          .where(eq(cvProfiles.id, candidate.id));
      }
      embedded++;
    } catch (err) {
      console.error(
        `[embedding-worker] store failed for ${candidate.kind}:${candidate.id}`,
        err,
      );
      failed++;
    }
  }

  return {
    processed: candidates.length,
    embedded,
    cached,
    failed,
  };
}

async function markFailed(
  candidate: Candidate,
  retryable: boolean,
  now: Date,
): Promise<void> {
  const db = await getDb();
  if (!retryable) {
    // Permanent failure: leave as 'failed' but don't increment.
    return;
  }
  if (candidate.kind === "job") {
    await db
      .update(jobs)
      .set({
        embeddingStatus: "failed",
        embeddingRetryCount: sql`${jobs.embeddingRetryCount} + 1`,
        embeddingLastAttemptAt: now,
      })
      .where(eq(jobs.id, candidate.id));
  } else {
    await db
      .update(cvProfiles)
      .set({
        embeddingStatus: "failed",
        embeddingRetryCount: sql`${cvProfiles.embeddingRetryCount} + 1`,
        embeddingLastAttemptAt: now,
      })
      .where(eq(cvProfiles.id, candidate.id));
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Format a number[] as a pgvector literal: "[0.1,0.2,...]" */
function pgVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
