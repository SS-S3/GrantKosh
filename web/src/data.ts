import MiniSearch from "minisearch";
import type { DatasetMeta, Investor, Opportunity, Status } from "./types";
import { todayIso } from "./format";

export interface Dataset {
  opportunities: Opportunity[];
  investors: Investor[];
  meta: DatasetMeta;
  oppIndex: MiniSearch<Opportunity>;
  invIndex: MiniSearch<Investor>;
  today: string;
}

const base = import.meta.env.BASE_URL;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`Couldn't load data/${path} (HTTP ${res.status}). Run "npm run scrape" first.`);
  return res.json() as Promise<T>;
}

/** The data may be days old; re-derive date-based status against the viewer's today. */
function liveStatus(o: Opportunity, today: string): Status {
  if (o.deadline) {
    if (o.deadline < today) return "closed";
    if (o.opensAt && o.opensAt > today) return "upcoming";
    return "open";
  }
  if (o.opensAt) return o.opensAt > today ? "upcoming" : o.status === "upcoming" ? "open" : o.status;
  return o.status;
}

/** One typo allowed from 4 letters, two from 9; none for very short words like "ai". */
const typoTolerance = (term: string) => (term.length >= 9 ? 2 : term.length >= 4 ? 1 : false);

export async function loadDataset(): Promise<Dataset> {
  const [opps, investors, meta] = await Promise.all([
    getJson<Opportunity[]>("opportunities.json"),
    getJson<Investor[]>("investors.json"),
    getJson<DatasetMeta>("meta.json"),
  ]);
  const today = todayIso();
  const opportunities = opps.map(o => ({ ...o, status: liveStatus(o, today) }));

  const oppIndex = new MiniSearch<Opportunity>({
    fields: ["title", "provider", "summary", "tagText"],
    storeFields: [],
    extractField: (doc, field) => (field === "tagText" ? [...doc.tags, ...doc.sectors, doc.programType].join(" ") : (doc as unknown as Record<string, string>)[field]),
    searchOptions: { boost: { title: 3, provider: 2, tagText: 1.5 }, prefix: true, fuzzy: typoTolerance, combineWith: "AND" },
  });
  oppIndex.addAll(opportunities);

  const invIndex = new MiniSearch<Investor>({
    fields: ["name", "city", "state", "category", "registrationNo", "email"],
    storeFields: [],
    searchOptions: { boost: { name: 3 }, prefix: true, fuzzy: typoTolerance, combineWith: "AND" },
  });
  invIndex.addAll(investors);

  return { opportunities, investors, meta, oppIndex, invIndex, today };
}
