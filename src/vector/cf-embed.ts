import { config } from "../config";
import { EmbeddingFailedError } from "../errors";

/**
 * Cloudflare Workers AI embedding provider.
 *
 * Same model as the local pipeline (bge-small-en-v1.5, 384 dim) served via
 * Workers AI's free tier — vectors are compatible with everything already
 * stored in Postgres, so switching providers requires no re-embedding.
 *
 * Free-tier handling baked in:
 *   - batches capped at EMBEDDING_BATCH (Workers AI max 100 texts/request)
 *   - 429/5xx retried with exponential backoff (honors retry-after)
 *   - output L2-normalized client-side so cosine similarity stays a dot product
 */

const CF_MODEL = "@cf/baai/bge-small-en-v1.5";
const MAX_ATTEMPTS = 4;

function cfConfig(): { accountId: string; apiToken: string } {
  if (!config.CF_ACCOUNT_ID || !config.CF_API_TOKEN) {
    throw new EmbeddingFailedError(
      "EMBEDDING_PROVIDER=cloudflare requires CF_ACCOUNT_ID and CF_API_TOKEN",
    );
  }
  return { accountId: config.CF_ACCOUNT_ID, apiToken: config.CF_API_TOKEN };
}

async function callCf(texts: string[]): Promise<number[][]> {
  const { accountId, apiToken } = cfConfig();
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: texts }),
    },
  );

  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    throw Object.assign(
      new Error(`workers ai ${res.status}`),
      { retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : null },
    );
  }
  if (!res.ok) {
    // 4xx other than 429: permanent (bad key, bad request) — don't retry.
    const body = await res.text().catch(() => "");
    throw new EmbeddingFailedError(
      `workers ai ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    success: boolean;
    result?: { data?: number[][] };
    errors?: Array<{ message?: string }>;
  };
  if (!json.success || !json.result?.data) {
    throw new EmbeddingFailedError(
      `workers ai error: ${json.errors?.[0]?.message ?? "no result data"}`,
    );
  }
  const data = json.result.data;
  if (data.length !== texts.length) {
    throw new EmbeddingFailedError(
      `workers ai returned ${data.length} vectors for ${texts.length} texts`,
    );
  }
  if (data[0] && data[0].length !== config.EMBEDDING_DIM) {
    throw new EmbeddingFailedError(
      `embedding dim mismatch: model emitted ${data[0].length}, expected ${config.EMBEDDING_DIM}`,
    );
  }
  return data;
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

async function callWithRetry(texts: string[]): Promise<number[][]> {
  let delayMs = 1_000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callCf(texts);
    } catch (err) {
      // 4xx (non-429) throws EmbeddingFailedError from callCf → permanent.
      if (err instanceof EmbeddingFailedError) throw err;
      if (attempt === MAX_ATTEMPTS) {
        throw new EmbeddingFailedError(
          `workers ai unavailable after ${MAX_ATTEMPTS} attempts: ${(err as Error).message}`,
          { batch: texts.length },
        );
      }
      const retryAfterMs = (err as { retryAfterMs?: number | null }).retryAfterMs;
      const wait = retryAfterMs ?? delayMs;
      await new Promise((r) => setTimeout(r, wait));
      delayMs *= 2;
    }
  }
  throw new EmbeddingFailedError("unreachable");
}

/** Embed a batch of texts (chunked to respect Workers AI request limits). */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const chunkSize = Math.min(config.EMBEDDING_BATCH, 100);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    try {
      const vectors = await callWithRetry(chunk);
      out.push(...vectors.map(l2Normalize));
    } catch (err) {
      if (err instanceof EmbeddingFailedError) throw err;
      throw new EmbeddingFailedError(
        `workers ai embedding failed: ${(err as Error).message}`,
        { batch: chunk.length },
      );
    }
  }
  return out;
}
