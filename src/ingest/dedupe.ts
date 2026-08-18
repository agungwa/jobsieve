import { createHash } from "node:crypto";
import type { NormalizedJob } from "../types/job";
import { normalizeText } from "./normalize";

/**
 * Compute a stable content hash for a normalized job.
 *
 * Inputs (after lowercasing + whitespace collapse + HTML strip on description):
 *   company, title, location, skills (sorted, canonical)
 *
 * The hash is stable across cosmetic description edits — only meaningful
 * identity changes produce a new hash.
 */
export function computeContentHash(job: NormalizedJob): string {
  const identity = [
    normalizeText(job.company),
    normalizeText(job.title),
    normalizeText(job.location ?? ""),
    [...job.skills].map(normalizeText).sort().join(","),
  ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}
