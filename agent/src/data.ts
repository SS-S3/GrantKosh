// Loads the dataset and keeps a full-text index of it. Reloads automatically when the scraper rewrites
// the JSON files, so a long-running server never serves stale data.
//
// The browser never downloads the data files: it searches through the API (directory.ts), which returns
// one page at a time. Records get opaque ids here, so ids in URLs and answers don't reveal where a
// record came from, and the copies sent to browsers leave out the source fields (publicOpportunity).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import type { Investor, Opportunity, Status } from "../../web/src/types";

// A Vercel function bundle carries its own copy next to it; otherwise the build's private copy
// (scripts/private-data.mjs moves it out of the served site), then the scraper's output in the repo.
const CANDIDATES = ["./data/", "../../web/dist-data/", "../../web/public/data/"].map(p => fileURLToPath(new URL(p, import.meta.url)));
export const DATA_DIR = process.env.GRANTKOSH_DATA_DIR ?? CANDIDATES.find(d => existsSync(`${d}opportunities.json`)) ?? CANDIDATES[1]!;

export interface Dataset {
  opportunities: Opportunity[];
  byId: Map<string, Opportunity>;
  investors: Investor[];
  oppIndex: MiniSearch<Opportunity>;
  invIndex: MiniSearch<Investor>;
  generatedAt: string;
  /** The day statuses were computed for (IST). */
  today: string;
}

const typoTolerance = (term: string) => (term.length >= 9 ? 2 : term.length >= 4 ? 1 : false);

const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
/** Today in India, where deadlines are read; the server's own time zone may be UTC. */
export function todayIso(now = new Date()): string {
  return IST_DAY.format(now);
}

/** Stable opaque id: the same record keeps the same id every day, but the id says nothing about its source. */
export const publicId = (id: string) => createHash("sha256").update(`grantkosh:${id}`).digest("base64url").slice(0, 12);

/** What a browser receives for a programme: everything except where it came from. */
export type PublicOpportunity = Omit<Opportunity, "source" | "alsoListedOn">;
export function publicOpportunity(o: Opportunity): PublicOpportunity {
  const { source: _s, alsoListedOn: _a, ...rest } = o;
  return rest;
}

export type PublicInvestor = Omit<Investor, "source" | "sourceUrl">;
export function publicInvestor(i: Investor): PublicInvestor {
  const { source: _s, sourceUrl: _u, ...rest } = i;
  return rest;
}

/** Same rule as the web app: dates win over the stored status, which may be days old. */
function liveStatus(o: Opportunity, today: string): Status {
  if (o.deadline) return o.deadline < today ? "closed" : o.opensAt && o.opensAt > today ? "upcoming" : "open";
  if (o.opensAt) return o.opensAt > today ? "upcoming" : o.status === "upcoming" ? "open" : o.status;
  return o.status;
}

export function buildDataset(opps: Opportunity[], investors: Investor[], generatedAt: string, today = todayIso()): Dataset {
  const opportunities = opps.map(o => ({ ...o, id: publicId(o.id), status: liveStatus(o, today) }));
  investors = investors.map(i => ({ ...i, id: publicId(i.id) }));
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
    fields: ["name", "city", "state", "category", "registrationNo", "email"],
    storeFields: [],
    searchOptions: { boost: { name: 3 }, prefix: true, fuzzy: typoTolerance, combineWith: "AND" },
  });
  invIndex.addAll(investors);
  return { opportunities, byId: new Map(opportunities.map(o => [o.id, o])), investors, oppIndex, invIndex, generatedAt, today };
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
