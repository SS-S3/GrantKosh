// Filtering, facet counting and sorting for funding opportunities.
import { daysUntil } from "./format";
import {
  COUNTRY, ENTITY, FOUNDER, FUNDING_TYPE, PROGRAM_TYPE, REGISTRATION, SECTOR, STAGE, STATES, STATUS,
} from "./labels";
import type { Opportunity } from "./types";

export const FUNDING_DEFAULTS = {
  q: "",
  /** Empty = automatic: best match while searching, closing soonest otherwise. */
  sort: "",
  quick: [] as string[],
  status: [] as string[],
  type: [] as string[],
  funding: [] as string[],
  stage: [] as string[],
  sector: [] as string[],
  state: [] as string[],
  founder: [] as string[],
  reg: [] as string[],
  entity: [] as string[],
  country: [] as string[],
  source: [] as string[],
  within: "",
  min: "",
  nationwide: "1",
};
export type FundingState = typeof FUNDING_DEFAULTS;
export type FacetKey = "status" | "type" | "funding" | "stage" | "sector" | "state" | "founder" | "reg" | "entity" | "country" | "source";

export interface Facet {
  key: FacetKey;
  title: string;
  values: (o: Opportunity) => readonly string[];
  labels: Record<string, string>;
  /** Fixed display order (else by count). */
  order?: string[];
  searchable?: boolean;
  hint?: string;
}

export const FACETS: Facet[] = [
  { key: "status", title: "Status", values: o => [o.status], labels: STATUS, order: ["open", "upcoming", "rolling", "unknown", "closed"] },
  { key: "stage", title: "Stage", values: o => o.stages, labels: STAGE, order: ["idea", "prototype", "early-revenue", "growth"] },
  { key: "type", title: "Program type", values: o => [o.programType], labels: PROGRAM_TYPE },
  { key: "funding", title: "Funding type", values: o => [o.fundingType], labels: FUNDING_TYPE },
  { key: "sector", title: "Industry", values: o => o.sectors.filter(s => s !== "any"), labels: SECTOR, searchable: true, hint: "Includes programs open to any sector" },
  { key: "state", title: "State", values: o => o.states.filter(s => s !== "pan-india"), labels: STATES, searchable: true },
  { key: "founder", title: "Founder type", values: o => o.founderTypes, labels: FOUNDER, hint: "Programs aimed specifically at these founders" },
  { key: "reg", title: "Registrations required", values: o => o.registrations, labels: REGISTRATION },
  { key: "entity", title: "Entity type", values: o => o.entityTypes, labels: ENTITY },
  { key: "country", title: "Region", values: o => [o.country], labels: COUNTRY, order: ["IN", "INT", "EU", "GB", "US"] },
  { key: "source", title: "Source", values: o => [o.source, ...o.alsoListedOn], labels: {} },
];

const GOVT_SOURCES = new Set(["myscheme", "birac", "idex", "grants-gov", "eu-funding", "ukri"]);
const GOVT_PROVIDER = /\b(ministry|department|dept|government|govt|mission|council|authority|commission|board|corporation|niti|dst|dbt|birac|isro|sidbi|nabard|meity|dpiit|startup india|state|national|federal|european commission|innovate uk)\b/i;

export const QUICK: Array<{ id: string; label: string; test: (o: Opportunity, today: string) => boolean }> = [
  { id: "closing", label: "Closing this month", test: (o, t) => o.status === "open" && !!o.deadline && daysUntil(o.deadline, t) <= 30 },
  { id: "open", label: "Open now", test: o => o.status === "open" || o.status === "rolling" },
  { id: "govt", label: "Government", test: o => GOVT_SOURCES.has(o.source) || GOVT_PROVIDER.test(o.provider) },
  { id: "women", label: "Women founders", test: o => o.founderTypes.includes("women") },
  { id: "dpiit", label: "DPIIT-recognised", test: o => o.registrations.includes("dpiit") },
  { id: "students", label: "Student founders", test: o => o.founderTypes.includes("student") },
  { id: "equity-free", label: "Equity-free", test: o => o.equityFree === true },
  { id: "pan-india", label: "Pan-India", test: o => o.states.includes("pan-india") },
  { id: "large", label: "Large (₹25L+)", test: o => (o.amountMaxInr ?? 0) >= 2_500_000 },
  { id: "india", label: "India only", test: o => o.country === "IN" },
  { id: "global", label: "International", test: o => o.country !== "IN" },
];

export const WITHIN = [
  { value: "", label: "Any time" },
  { value: "7", label: "Next 7 days" },
  { value: "30", label: "Next 30 days" },
  { value: "90", label: "Next 3 months" },
  { value: "rolling", label: "Rolling / no deadline" },
];

export const MIN_AMOUNT = [
  { value: "", label: "Any amount" },
  { value: "500000", label: "₹5L+" },
  { value: "2500000", label: "₹25L+" },
  { value: "10000000", label: "₹1Cr+" },
  { value: "100000000", label: "₹10Cr+" },
];

export const SORTS = [
  { value: "closing", label: "Closing soonest" },
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newly added" },
  { value: "amount", label: "Largest amount" },
  { value: "az", label: "A → Z" },
];

function facetPass(f: Facet, o: Opportunity, selected: string[], s: FundingState): boolean {
  if (!selected.length) return true;
  const vals = f.values(o);
  if (vals.some(v => selected.includes(v))) return true;
  if (f.key === "sector" && o.sectors.includes("any")) return true;
  if (f.key === "state" && s.nationwide === "1" && o.states.includes("pan-india")) return true;
  return false;
}

function basePass(o: Opportunity, s: FundingState, today: string, hits: Map<string, number> | null): boolean {
  if (hits && !hits.has(o.id)) return false;
  for (const id of s.quick) {
    const q = QUICK.find(x => x.id === id);
    if (q && !q.test(o, today)) return false;
  }
  if (s.within === "rolling") {
    if (o.deadline || o.status === "closed") return false;
  } else if (s.within) {
    if (o.status !== "open" || !o.deadline || daysUntil(o.deadline, today) > Number(s.within)) return false;
  }
  if (s.min && (o.amountMaxInr ?? 0) < Number(s.min)) return false;
  return true;
}

export interface FundingResult {
  rows: Opportunity[];
  counts: Record<FacetKey, Map<string, number>>;
}

export function applyFunding(all: Opportunity[], s: FundingState, today: string, hits: Map<string, number> | null): FundingResult {
  const counts = Object.fromEntries(FACETS.map(f => [f.key, new Map<string, number>()])) as Record<FacetKey, Map<string, number>>;
  const rows: Opportunity[] = [];
  const bump = (f: Facet, o: Opportunity) => {
    const m = counts[f.key];
    for (const v of new Set(f.values(o))) m.set(v, (m.get(v) ?? 0) + 1);
  };

  for (const o of all) {
    if (!basePass(o, s, today, hits)) continue;
    // Facet counts show what you'd get by ticking a box, given every *other* filter.
    let failed: Facet | null = null;
    let failures = 0;
    for (const f of FACETS) {
      if (!facetPass(f, o, s[f.key], s)) {
        failures++;
        failed = f;
        if (failures > 1) break;
      }
    }
    if (failures === 0) {
      rows.push(o);
      for (const f of FACETS) bump(f, o);
    } else if (failures === 1) bump(failed!, o);
  }
  return { rows: sortFunding(rows, s.sort, hits), counts };
}

function closingRank(o: Opportunity): number {
  if (o.status === "open" && o.deadline) return 0;
  if (o.status === "open" || o.status === "rolling") return 1;
  if (o.status === "upcoming") return 2;
  if (o.status === "unknown") return 3;
  return 4;
}

export function sortFunding(rows: Opportunity[], sort: string, hits: Map<string, number> | null): Opportunity[] {
  const by = (fn: (a: Opportunity, b: Opportunity) => number) => [...rows].sort((a, b) => fn(a, b) || a.title.localeCompare(b.title));
  switch (sort) {
    case "relevance":
      if (hits) return by((a, b) => (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0));
      return sortFunding(rows, "closing", null);
    case "newest":
      return by((a, b) => b.firstSeen.localeCompare(a.firstSeen) || (b.opensAt ?? "").localeCompare(a.opensAt ?? ""));
    case "amount":
      return by((a, b) => (b.amountMaxInr ?? -1) - (a.amountMaxInr ?? -1));
    case "az":
      return by(() => 0);
    default:
      return by((a, b) => {
        const r = closingRank(a) - closingRank(b);
        if (r) return r;
        if (closingRank(a) === 0) return a.deadline!.localeCompare(b.deadline!);
        if (closingRank(a) === 2) return (a.opensAt ?? "9999").localeCompare(b.opensAt ?? "9999");
        if (closingRank(a) === 4) return (b.deadline ?? "").localeCompare(a.deadline ?? "");
        // Among undated programs, prefer human-verified, then higher-confidence records.
        return Number(b.verified) - Number(a.verified) || confidenceRank(a) - confidenceRank(b);
      });
  }
}

const confidenceRank = (o: Opportunity) => (o.confidence === "high" ? 0 : o.confidence === "medium" ? 1 : 2);

export function activeFilterCount(s: FundingState): number {
  return FACETS.reduce((n, f) => n + s[f.key].length, 0) + s.quick.length + (s.within ? 1 : 0) + (s.min ? 1 : 0);
}
