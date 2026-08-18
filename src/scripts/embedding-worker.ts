/**
 * Manual one-shot embedding worker. Usage: `bun ingest:embedding-worker`
 */
import { runEmbeddingTick } from "../scheduler/embedding-worker";
import { closeDb } from "../db/client";

async function main() {
  console.info("[embedding-worker] starting tick…");
  const result = await runEmbeddingTick();
  console.info(
    `[embedding-worker] processed=${result.processed} embedded=${result.embedded} cached=${result.cached} failed=${result.failed}`,
  );
  await closeDb();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[embedding-worker] fatal:", err);
    process.exit(1);
  });
