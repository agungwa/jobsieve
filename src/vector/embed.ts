import { config } from "../config";
import * as cfEmbed from "./cf-embed";

/**
 * Embedding dispatcher.
 *
 *   local       → transformers.js on-host (default; needs Bun/Node + ~130MB model)
 *   cloudflare  → Workers AI REST call to the SAME bge-small-en-v1.5 model
 *                 (serverless-friendly: no model download, free tier)
 *
 * The cloudflare path is imported statically so the Vercel bundler always
 * includes it. The local path uses an indirect dynamic import on purpose:
 * a literal `import("./local-embed")` would statically pull the heavyweight
 * @huggingface/transformers dependency into the serverless bundle (250MB
 * limit) even when the provider is cloudflare. The indirection defeats
 * static tracing; it only resolves at runtime when actually used.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (config.EMBEDDING_PROVIDER === "cloudflare") {
    return cfEmbed.embedBatch(texts);
  }
  const specifier = "./local-embed";
  const mod = (await import(specifier)) as typeof import("./local-embed");
  return mod.embedBatch(texts);
}

/** Warm-up only applies to the local provider (model download + init). */
export async function warmUp(): Promise<void> {
  if (config.EMBEDDING_PROVIDER !== "local") return;
  const specifier = "./local-embed";
  const mod = (await import(specifier)) as typeof import("./local-embed");
  await mod.warmUp();
}
