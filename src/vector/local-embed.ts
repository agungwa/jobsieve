import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { config } from "../config";
import { EmbeddingFailedError } from "../errors";

/**
 * Local embedding pipeline using transformers.js.
 *
 * Model: bge-small-en-v1.5 (384 dim, ~130MB). Runs on-device — no API key,
 * no per-call token cost, no network. Aligns with the token-minimization goal:
 * embedding jobs and CVs is permanently free.
 *
 * First call lazy-loads the model (~2s warm-up). Subsequent calls are fast.
 */

let _pipe: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!_pipe) {
    // Allow downloading from HF hub if not cached.
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    _pipe = pipeline("feature-extraction", `Xenova/${config.EMBEDDING_MODEL}`, {
      dtype: "q8",
    }) as Promise<FeatureExtractionPipeline>;
  }
  return _pipe;
}

/**
 * Embed a batch of texts. Returns vectors in input order. Each vector is
 * mean-pooled and L2-normalized so cosine similarity is a simple dot product.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const pipe = await getPipeline();
    const out = await pipe(texts, { pooling: "mean", normalize: true });
    // out.dims is [batch, tokens, dim] before pooling, [batch, dim] after.
    // transformers.js returns a Tensor; convert to nested number[][].
    const dims = out.dims;
    const data = out.data as Float32Array;
    if (dims.length !== 2) {
      throw new Error(`unexpected tensor rank: ${dims.length}`);
    }
    const [batch, dim] = dims as [number, number];
    if (dim !== config.EMBEDDING_DIM) {
      throw new Error(
        `embedding dim mismatch: model emitted ${dim}, expected ${config.EMBEDDING_DIM}. ` +
          `Update EMBEDDING_DIM in .env and regenerate the migration.`,
      );
    }
    const result: number[][] = [];
    for (let i = 0; i < batch; i++) {
      const slice = Array.from(data.subarray(i * dim, (i + 1) * dim));
      result.push(slice);
    }
    return result;
  } catch (err) {
    throw new EmbeddingFailedError(
      `local embedding failed: ${(err as Error).message}`,
      { cause: err, batch: texts.length },
    );
  }
}

/**
 * One-time warm-up. Call on boot to avoid a slow first user-facing request.
 */
export async function warmUp(): Promise<void> {
  await embedBatch(["warmup"]).catch((err) => {
    console.error("[local-embed] warm-up failed:", err);
  });
}
