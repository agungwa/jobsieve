import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, getRawClient } from "./client";
import { config } from "../config";

/**
 * Applies pending migrations in `./drizzle` and idempotently installs the
 * pgvector extension + HNSW indexes for cosine similarity.
 */
async function main() {
  console.info("[migrate] connecting…");
  const db = await getDb();
  const raw = await getRawClient();

  // 1. Install pgvector FIRST — the migration SQL uses `vector(512)` type.
  console.info("[migrate] installing pgvector extension");
  await raw.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

  // 2. Drizzle migrations.
  console.info("[migrate] drizzle migrations");
  await migrate(db, { migrationsFolder: "./drizzle" });

  // 3. HNSW indexes for cosine ANN. Low ef_construction is fine at our scale;
  // tune upward once the corpus exceeds ~250k rows.
  console.info("[migrate] creating HNSW indexes");
  await raw.unsafe(`
    CREATE INDEX IF NOT EXISTS jobs_embedding_hnsw_idx
      ON jobs USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  `);
  await raw.unsafe(`
    CREATE INDEX IF NOT EXISTS cv_profiles_embedding_hnsw_idx
      ON cv_profiles USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  `);

  console.info(
    `[migrate] done (dim=${config.EMBEDDING_DIM}, model=${config.EMBEDDING_MODEL})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate] failed:", err);
    process.exit(1);
  });
