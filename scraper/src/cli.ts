#!/usr/bin/env node
// Usage: npm run scrape -- [options]
import { setMaxListeners } from "node:events";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { todayIso } from "./core/dates.js";
import { setLogLevel } from "./core/log.js";
import { runPipeline } from "./pipeline.js";
import { SOURCES } from "./sources/index.js";

// Many parallel fetches share undici's internal abort signals; the default cap of 10 only adds noise.
setMaxListeners(64);

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
// npm workspaces run scripts inside scraper/; resolve user paths against where npm was invoked.
const userPath = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

const HELP = `GrantKosh scraper — collects grants, schemes and investors into web/public/data.

Options
  --only <ids>       Comma-separated sources to run (others are carried over from the last run)
  --skip <ids>       Comma-separated sources to leave out of this run
  --limit <n>        Cap items per source (quick test). Implies --dry-run unless --out is given
  --out <dir>        Output directory (default: web/public/data)
  --state <dir>      Incremental state directory (default: data/state)
  --cache            Cache HTTP responses in .cache/http for 12h (handy while developing)
  --today <date>     Pretend the run happens on YYYY-MM-DD (statuses are computed against it)
  --accept-drops     Accept a source whose record count fell sharply instead of keeping last run's data
  --dry-run          Run everything but don't write files
  --verbose          Debug logging
  --list             List sources and exit
  --help             Show this help

Sources
${SOURCES.map(s => `  ${s.id.padEnd(12)} ${s.kind.padEnd(13)} ${s.name}`).join("\n")}
`;

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    skip: { type: "string" },
    limit: { type: "string" },
    out: { type: "string" },
    state: { type: "string" },
    cache: { type: "boolean", default: false },
    today: { type: "string" },
    "accept-drops": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help || values.list) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (values.verbose) setLogLevel("debug");

const ids = (s?: string) => (s ? s.split(",").map(x => x.trim()).filter(Boolean) : []);
const limit = values.limit ? Number(values.limit) : null;
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  console.error("--limit must be a positive integer");
  process.exit(2);
}
if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) {
  console.error("--today must be YYYY-MM-DD");
  process.exit(2);
}

try {
  const meta = await runPipeline({
    outDir: values.out ? userPath(values.out) : root("web/public/data"),
    stateDir: values.state ? userPath(values.state) : root("data/state"),
    cacheDir: values.cache ? root(".cache/http") : null,
    today: values.today ?? todayIso(),
    only: values.only ? ids(values.only) : null,
    skip: ids(values.skip),
    limit,
    acceptDrops: values["accept-drops"],
    dryRun: values["dry-run"] || (limit !== null && !values.out),
  });
  const rows = meta.sources.map(s => `  ${s.ok ? "✓" : s.stale ? "~" : "✗"} ${s.id.padEnd(12)} ${String(s.count).padStart(6)}${s.rejected ? `  (${s.rejected} rejected)` : ""}${s.error ? `  ${s.error}` : ""}`);
  process.stdout.write(`\n${rows.join("\n")}\n\n  ${meta.opportunities} opportunities · ${meta.investors} investors\n`);
  process.exit(meta.sources.some(s => !s.ok) ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(2);
}
