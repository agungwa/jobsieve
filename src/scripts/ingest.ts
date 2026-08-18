/**
 * Manual ingest entry. Usage:
 *   bun ingest                 # run all adapters
 *   bun ingest arbeitnow       # one adapter
 */
import { runAtsSource, runSource } from "../ingest/pipeline";
import { arbeitnow } from "../sources/arbeitnow";
import { remotive } from "../sources/remotive";
import { remoteok } from "../sources/remoteok";
import { greenhouse } from "../sources/ats/greenhouse";
import { lever } from "../sources/ats/lever";
import { ashby } from "../sources/ats/ashby";
import type { SourceAdapter } from "../sources/types";

const simpleAdapters = {
  arbeitnow,
  remotive,
  remoteok,
} satisfies Record<string, SourceAdapter>;

const atsAdapters = {
  greenhouse,
  lever,
  ashby,
};

const allNames = [...Object.keys(simpleAdapters), ...Object.keys(atsAdapters)] as const;
type AdapterName = (typeof allNames)[number];

async function main() {
  const requested = process.argv.slice(2) as AdapterName[];
  const names =
    requested.length > 0
      ? requested.filter((n): n is AdapterName => (allNames as readonly string[]).includes(n))
      : ([...allNames] as AdapterName[]);

  if (names.length === 0) {
    console.error("No adapters selected. Available:", allNames.join(", "));
    process.exit(2);
  }

  for (const name of names) {
    if (name in simpleAdapters) {
      console.info(`[ingest] running ${name}…`);
      const result = await runSource(simpleAdapters[name as keyof typeof simpleAdapters]);
      console.info(`[ingest] ${name}: fetched=${result.fetched} error=${result.error ?? "none"}`);
    } else {
      console.info(`[ingest] running ATS ${name}…`);
      const result = await runAtsSource(
        atsAdapters[name as keyof typeof atsAdapters] as never,
      );
      console.info(
        `[ingest] ${name}: boards=${result.boards} fetched=${result.fetched} error=${result.error ?? "none"}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ingest] fatal:", err);
    process.exit(1);
  });
