import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

/**
 * Connection-retry wrapper around `postgres()`. Drizzle's postgres-js driver
 * attaches a default 20-second connect attempt, but during local dev the
 * docker-compose Postgres may still be booting. We retry a few times before
 * surfacing the error to Bun.serve.
 *
 * Serverless notes (Vercel + Neon):
 *   - Neon pooled endpoints (host contains "-pooler") sit behind pgBouncer in
 *     transaction mode → prepared statements must be disabled.
 *   - Idle connections are recycled aggressively so thawed/frozen function
 *     instances don't hold sockets against Neon's connection cap.
 */
async function connectWithRetry(
  url: string,
  maxAttempts = 10,
  delayMs = 1_000,
) {
  const isPooled = /-pooler|neon\.tech/i.test(new URL(url).hostname);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = postgres(url, {
        max: config.DATABASE_MAX_POOL,
        connect_timeout: Math.ceil(config.DATABASE_CONNECT_TIMEOUT_MS / 1000),
        onnotice: () => {}, // silence NOTICE logs
        ...(isPooled
          ? {
              prepare: false, // pgBouncer transaction mode
              idle_timeout: 20,
              max_lifetime: 60 * 30,
            }
          : {}),
      });
      // Validate the connection is actually live.
      await client`SELECT 1`;
      return client;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[db] connect attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function getDb() {
  if (!_db) {
    _client = await connectWithRetry(config.DATABASE_URL);
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Raw SQL template for cases where Drizzle's builder is insufficient
 * (e.g., pgvector's `<=>` operator and ANN queries).
 */
export async function getRawClient() {
  if (!_client) {
    await getDb();
  }
  return _client!;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
