// Directory API: the browser searches and filters through these endpoints and gets one page at a time,
// so the full dataset is never sent to it.
//   GET  /api/stats                       → headline counts and the data date
//   GET  /api/funding?<filters>&offset=   → a page of programmes plus facet counts (same query string as the page URL)
//   GET  /api/opportunity?id=             → one programme
//   GET  /api/investors?<filters>&offset= → a page of SEBI-registered funds plus facet counts
//   POST /api/match                       → guided matching: { profile, text } → ranked programmes with reasons
// Filtering, counting and ranking reuse the web app's own modules, so results match what the UI used to compute.
import { z } from "zod";
import { applyFunding, FACETS, FUNDING_DEFAULTS, type FacetKey } from "../../web/src/funding";
import { applyInvestors, INVESTOR_DEFAULTS, INVESTOR_FACETS, type InvestorKey } from "../../web/src/investors";
import { rankPrograms, type StartupProfile } from "../../web/src/match";
import { parseQuery } from "../../web/src/query";
import { type Dataset, publicInvestor, publicOpportunity } from "./data";

const PAGE = 30;
const MAX_PAGE = 50;

function paging(p: URLSearchParams): { offset: number; limit: number } {
  const offset = Math.max(0, Math.min(100_000, Number(p.get("offset")) || 0));
  const limit = Math.max(1, Math.min(MAX_PAGE, Number(p.get("limit")) || PAGE));
  return { offset, limit };
}

/** Facet counts as [value, count] pairs; ticked values are always listed, even at zero. */
function countsOut<K extends string>(counts: Record<K, Map<string, number>>, selected: Record<K, string[]>): Record<K, Array<[string, number]>> {
  const out = {} as Record<K, Array<[string, number]>>;
  for (const key of Object.keys(counts) as K[]) {
    const m = new Map(counts[key]);
    for (const v of selected[key]) if (!m.has(v)) m.set(v, 0);
    out[key] = [...m.entries()];
  }
  return out;
}

export function stats(ds: Dataset) {
  return {
    programs: ds.opportunities.length,
    openNow: ds.opportunities.filter(o => o.status === "open" || o.status === "rolling").length,
    investors: ds.investors.length,
    generatedAt: ds.generatedAt,
    today: ds.today,
  };
}

const textHits = (ds: Dataset, q: string, index: "opp" | "inv") => {
  const query = q.trim();
  if (!query) return null;
  const idx = index === "opp" ? ds.oppIndex : ds.invIndex;
  return new Map(idx.search(query, { combineWith: "AND" }).map(r => [r.id as string, r.score]));
};

export function funding(ds: Dataset, p: URLSearchParams) {
  const s = parseQuery(FUNDING_DEFAULTS, p);
  const hits = textHits(ds, s.q, "opp");
  const sort = !s.sort || (s.sort === "relevance" && !hits) ? (hits ? "relevance" : "closing") : s.sort;
  const { rows, counts } = applyFunding(ds.opportunities, { ...s, sort }, ds.today, hits);
  const { offset, limit } = paging(p);
  const selected = Object.fromEntries(FACETS.map(f => [f.key, s[f.key]])) as Record<FacetKey, string[]>;
  return { total: rows.length, offset, items: rows.slice(offset, offset + limit).map(publicOpportunity), counts: countsOut(counts, selected), sort, searching: !!hits };
}

export function opportunity(ds: Dataset, id: string) {
  const o = ds.byId.get(id);
  return o ? publicOpportunity(o) : null;
}

export function investors(ds: Dataset, p: URLSearchParams) {
  const s = parseQuery(INVESTOR_DEFAULTS, p);
  const hits = textHits(ds, s.q, "inv");
  const { rows, counts } = applyInvestors(ds.investors, s, hits);
  const { offset, limit } = paging(p);
  const selected = Object.fromEntries(INVESTOR_FACETS.map(f => [f.key, s[f.key]])) as Record<InvestorKey, string[]>;
  return { total: rows.length, offset, items: rows.slice(offset, offset + limit).map(publicInvestor), counts: countsOut(counts, selected), searching: !!hits };
}

const slug = z.string().max(40);
export const MatchBody = z.object({
  text: z.string().max(500).default(""),
  profile: z
    .object({
      sectors: z.array(slug).max(10).optional(),
      stage: slug.optional(),
      state: slug.optional(),
      founderTypes: z.array(slug).max(10).optional(),
      dpiit: z.boolean().optional(),
      entityType: slug.optional(),
      needInr: z.number().nonnegative().max(1e12).optional(),
      equityOk: z.boolean().optional(),
      international: z.boolean().optional(),
      includeClosed: z.boolean().optional(),
    })
    .default({}),
});

/** Guided matching: ranks programmes on the profile, boosted (or, without a profile, filtered) by the free text. */
export function match(ds: Dataset, body: z.infer<typeof MatchBody>) {
  const p = body.profile as StartupProfile;
  const text = body.text.trim() ? new Map(ds.oppIndex.search(body.text, { combineWith: "OR" }).map(r => [r.id as string, r.score])) : null;
  const hasProfile = !!(p.sectors?.length || p.stage || p.state || p.founderTypes?.length);
  return rankPrograms(ds.opportunities, p, ds.today, text, 12, hasProfile ? "boost" : "filter").map(m => ({
    program: publicOpportunity(m.program),
    score: Math.round(m.score),
    reasons: m.reasons,
    cautions: m.cautions,
  }));
}
