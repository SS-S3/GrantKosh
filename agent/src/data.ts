// Loads the published dataset and keeps a full-text index of it. Reloads automatically when the
// scraper rewrites the JSON files, so a long-running server never serves stale data.
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import type { Investor, Opportunity, Status } from "../../web/src/types";

// Prefer the built site's copy (what users download), then the scraper's output in the repo.
const CANDIDATES = ["../../web/dist/data/", "../../web/public/data/"].map(p => fileURLToPath(new URL(p, import.meta.url)));
export const DATA_DIR = process.env.GRANTKOSH_DATA_DIR ?? CANDIDATES.find(d => existsSync(`${d}opportunities.json`)) ?? CANDIDATES[1]!;

export interface Dataset {
  opportunities: Opportunity[];
  byId: Map<string, Opportunity>;
  investors: Investor[];
  oppIndex: MiniSearch<Opportunity>;
  invIndex: MiniSearch<Investor>;
  generatedAt: string;
}

const typoTolerance = (term: string) => (term.length >= 9 ? 2 : term.length >= 4 ? 1 : false);

export function todayIso(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Same rule as the web app: dates win over the stored status, which may be days old. */
function liveStatus(o: Opportunity, today: string): Status {
  if (o.deadline) return o.deadline < today ? "closed" : o.opensAt && o.opensAt > today ? "upcoming" : "open";
  if (o.opensAt) return o.opensAt > today ? "upcoming" : o.status === "upcoming" ? "open" : o.status;
  return o.status;
}

export function buildDataset(opps: Opportunity[], investors: Investor[], generatedAt: string, today = todayIso()): Dataset {
  const opportunities = opps.map(o => ({ ...o, status: liveStatus(o, today) }));
  const oppIndex = new MiniSearch<Opportunity>({
    fields: ["title", "provider", "summary", "tagText"],
    storeFields: [],
    extractField: (doc, field) =>
      field === "tagText" ? [...doc.tags, ...doc.sectors, doc.programType].join(" ") : (doc as unknown as Record<string, string>)[field],
    // OR + prefix + typos: founders describe products loosely; scoring sorts it out.
    searchOptions: { boost: { title: 3, provider: 2, tagText: 1.5 }, prefix: true, fuzzy: typoTolerance, combineWith: "OR" },
  });
  oppIndex.addAll(opportunities);
  const invIndex = new MiniSearch<Investor>({
    fields: ["name", "city", "state", "category"],
    storeFields: [],
    searchOptions: { boost: { name: 3 }, prefix: true, fuzzy: typoTolerance, combineWith: "AND" },
  });
  invIndex.addAll(investors);
  return { opportunities, byId: new Map(opportunities.map(o => [o.id, o])), investors, oppIndex, invIndex, generatedAt };
}

let cached: { dataset: Dataset; mtime: number; day: string } | null = null;

export function getDataset(): Dataset {
  const file = `${DATA_DIR}opportunities.json`;
  const mtime = statSync(file).mtimeMs;
  const day = todayIso();
  if (cached && cached.mtime === mtime && cached.day === day) return cached.dataset;
  const read = <T>(name: string): T => JSON.parse(readFileSync(`${DATA_DIR}${name}`, "utf8")) as T;
  const meta = read<{ generatedAt: string }>("meta.json");
  const dataset = buildDataset(read<Opportunity[]>("opportunities.json"), read<Investor[]>("investors.json"), meta.generatedAt, day);
  cached = { dataset, mtime, day };
  return dataset;
}
