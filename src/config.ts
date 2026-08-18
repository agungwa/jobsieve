import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),

  // Postgres + pgvector
  DATABASE_URL: z.string().url(),
  DATABASE_MAX_POOL: z.coerce.number().default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().default(30_000),

  // GLM (Z.ai / ZhipuAI) — chat only; embeddings run separately.
  // Optional: without it the app boots fine and chat requires a visitor's
  // own key (BYOK) — zero shared-key cost for the operator.
  GLM_API_KEY: z.string().optional(),
  GLM_BASE_URL: z
    .string()
    .url()
    .default("https://api.z.ai/api/anthropic"),
  GLM_MODEL_ADMIN: z.string().default("glm-4.6"),
  GLM_MODEL_USER: z.string().default("glm-4.5-air"), // cheap tier for anon users

  // Embedding strategy
  EMBEDDING_PROVIDER: z.enum(["local", "cloudflare"]).default("local"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(384),
  EMBEDDING_BATCH: z.coerce.number().int().positive().default(64),
  EMBEDDING_WORKER_INTERVAL_CRON: z.string().default("* * * * *"), // every minute
  EMBEDDING_MAX_RETRIES: z.coerce.number().int().positive().default(6),
  EMBEDDING_MODEL: z.string().default("bge-small-en-v1.5"),

  // Cloudflare Workers AI (EMBEDDING_PROVIDER=cloudflare). Same bge-small
  // model as the local pipeline, so vectors stay compatible.
  CF_ACCOUNT_ID: z.string().optional(),
  CF_API_TOKEN: z.string().optional(),

  // Admin identity
  ADMIN_API_KEY: z.string().min(1),

  // Rate limit (anon, per-IP)
  RATE_LIMIT_PER_DAY: z.coerce.number().int().positive().default(10),

  // Ingest endpoint (Vercel cron) time budget + self-invocation
  INGEST_TIME_BUDGET_MS: z.coerce.number().int().positive().default(50_000),
  CRON_SECRET: z.string().optional(),
  VERCEL_URL: z.string().optional(),

  // Job staleness
  JOB_STALENESS_DAYS: z.coerce.number().int().positive().default(30),

  // CV upload limits (4MB: Vercel functions hard-reject bodies >4.5MB)
  CV_MAX_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024),

  // Cron schedules per source
  CRON_ARBEITNOW: z.string().default("0 * * * *"), // hourly
  CRON_REMOTIVE: z.string().default("30 * * * *"),
  CRON_REMOTEOK: z.string().default("15 */4 * * *"), // every 4h
  CRON_GREENHOUSE: z.string().default("0 */2 * * *"),
  CRON_LEVER: z.string().default("30 */2 * * *"),
  CRON_ASHBY: z.string().default("0 */3 * * *"),
  CRON_CLEANUP: z.string().default("17 3 * * *"), // daily 03:17

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${errors}`);
  }
  return parsed.data;
}

export const config = loadConfig();

/**
 * Timing-safe admin key comparison. Both sides are hashed first so the
 * comparison length is constant — prevents leaking the key's length or
 * prefix through response-time differences.
 */
export function isAdminKey(key: string | undefined | null): boolean {
  if (!key || key.length > 500) return false;
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(config.ADMIN_API_KEY).digest();
  return timingSafeEqual(a, b);
}
