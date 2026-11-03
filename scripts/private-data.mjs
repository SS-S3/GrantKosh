// Moves the data files out of the built site, so they are never served as static files. The API reads
// them from web/dist-data and returns one page of results at a time. Runs after the web build.
// Usage: node scripts/private-data.mjs [dist=web/dist]
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const dist = process.argv[2] ?? new URL("../web/dist", import.meta.url).pathname;
const target = join(dirname(dist), "dist-data");
rmSync(target, { recursive: true, force: true });
if (existsSync(join(dist, "data"))) renameSync(join(dist, "data"), target);
console.log(`data files moved out of the site to ${target}`);
