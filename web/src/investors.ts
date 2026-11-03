// Filtering, facet counting and sorting for the investor register. Runs on the server (directory API).
import type { Investor } from "./types";

export const INVESTOR_DEFAULTS = { q: "", sort: "name", kind: [] as string[], category: [] as string[], state: [] as string[], city: [] as string[] };
export type InvestorState = typeof INVESTOR_DEFAULTS;
export type InvestorKey = "kind" | "category" | "state" | "city";

export const INVESTOR_FACETS: Array<{ key: InvestorKey; title: string; values: (i: Investor) => string[]; searchable?: boolean }> = [
  { key: "kind", title: "Investor type", values: i => [i.kind] },
  { key: "category", title: "SEBI category", values: i => (i.category ? [i.category] : []) },
  { key: "state", title: "State", values: i => (i.state ? [i.state] : []), searchable: true },
  { key: "city", title: "City", values: i => (i.city ? [i.city] : []), searchable: true },
];

export function applyInvestors(all: Investor[], s: InvestorState, hits: Map<string, number> | null) {
  const counts = Object.fromEntries(INVESTOR_FACETS.map(f => [f.key, new Map<string, number>()])) as Record<InvestorKey, Map<string, number>>;
  const rows: Investor[] = [];
  for (const inv of all) {
    if (hits && !hits.has(inv.id)) continue;
    // Facet counts show what you'd get by ticking a box, given every *other* filter.
    const fails = INVESTOR_FACETS.filter(f => s[f.key].length && !f.values(inv).some(v => s[f.key].includes(v)));
    const bump = (f: (typeof INVESTOR_FACETS)[number]) => f.values(inv).forEach(v => counts[f.key].set(v, (counts[f.key].get(v) ?? 0) + 1));
    if (!fails.length) {
      rows.push(inv);
      INVESTOR_FACETS.forEach(bump);
    } else if (fails.length === 1) bump(fails[0]!);
  }
  rows.sort((a, b) => {
    if (s.sort === "relevance" && hits) return (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0);
    if (s.sort === "newest") return (b.registeredOn ?? "").localeCompare(a.registeredOn ?? "");
    if (s.sort === "oldest") return (a.registeredOn ?? "9999").localeCompare(b.registeredOn ?? "9999");
    return a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
  });
  return { rows, counts };
}
