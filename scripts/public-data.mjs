// Trims the data files in the built site to what the app needs, so the published copy doesn't list
// where the data comes from. The full files stay in web/public/data for the scraper and the repo.
// Runs after the web build and before compression. Usage: node scripts/public-data.mjs [dir=web/dist]
import { readFileSync, writeFileSync } from "node:fs";

const dir = `${process.argv[2] ?? new URL("../web/dist", import.meta.url).pathname}/data`;
const read = name => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
// One record per line, like the scraper writes, so files stay readable and compress well.
const write = (name, rows) => writeFileSync(`${dir}/${name}`, Array.isArray(rows) ? `[\n${rows.map(r => JSON.stringify(r)).join(",\n")}\n]\n` : `${JSON.stringify(rows)}\n`);

const meta = read("meta.json");
write("meta.json", { generatedAt: meta.generatedAt, opportunities: meta.opportunities, investors: meta.investors, sources: [] });

// `source` stays: the "Government" quick filter uses it. The list of other sites carrying a programme goes.
write("opportunities.json", read("opportunities.json").map(({ alsoListedOn: _, ...o }) => ({ ...o, alsoListedOn: [] })));
console.log("public data: source details removed from meta.json and opportunities.json");
