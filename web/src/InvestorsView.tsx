import { useMemo } from "react";
import { FilterGroup, SearchBox, useShowMore } from "./components";
import { downloadCsv } from "./csv";
import type { Dataset } from "./data";
import { fmtDate } from "./format";
import { INVESTOR_KIND } from "./labels";
import type { Investor } from "./types";
import { useUrlState } from "./urlState";

const DEFAULTS = { q: "", sort: "name", kind: [] as string[], category: [] as string[], state: [] as string[], city: [] as string[] };
type Key = "kind" | "category" | "state" | "city";

const FACETS: Array<{ key: Key; title: string; values: (i: Investor) => string[]; searchable?: boolean }> = [
  { key: "kind", title: "Investor type", values: i => [i.kind] },
  { key: "category", title: "SEBI category", values: i => (i.category ? [i.category] : []) },
  { key: "state", title: "State", values: i => (i.state ? [i.state] : []), searchable: true },
  { key: "city", title: "City", values: i => (i.city ? [i.city] : []), searchable: true },
];

const CATEGORY_HINT: Record<string, string> = {
  "AIF Category I": "AIF Category I (VC, angel, SME, social)",
  "AIF Category II": "AIF Category II (PE, debt, VC)",
  "AIF Category III": "AIF Category III (hedge, listed)",
};

export function InvestorsView({ data }: { data: Dataset }) {
  const { state: s, set, toggle, reset } = useUrlState(DEFAULTS, ["tab"]);
  const hits = useMemo(() => (s.q.trim() ? new Map(data.invIndex.search(s.q.trim()).map(r => [r.id as string, r.score])) : null), [s.q, data.invIndex]);

  const { rows, counts } = useMemo(() => {
    const counts = Object.fromEntries(FACETS.map(f => [f.key, new Map<string, number>()])) as Record<Key, Map<string, number>>;
    const rows: Investor[] = [];
    for (const inv of data.investors) {
      if (hits && !hits.has(inv.id)) continue;
      const fails = FACETS.filter(f => s[f.key].length && !f.values(inv).some(v => s[f.key].includes(v)));
      const bump = (f: (typeof FACETS)[number]) => f.values(inv).forEach(v => counts[f.key].set(v, (counts[f.key].get(v) ?? 0) + 1));
      if (!fails.length) {
        rows.push(inv);
        FACETS.forEach(bump);
      } else if (fails.length === 1) bump(fails[0]!);
    }
    const sorted = [...rows].sort((a, b) => {
      if (s.sort === "relevance" && hits) return (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0);
      if (s.sort === "newest") return (b.registeredOn ?? "").localeCompare(a.registeredOn ?? "");
      if (s.sort === "oldest") return (a.registeredOn ?? "9999").localeCompare(b.registeredOn ?? "9999");
      return a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
    });
    return { rows: sorted, counts };
  }, [data.investors, s, hits]);

  const page = useShowMore(rows, 50, JSON.stringify(s));
  const active = FACETS.reduce((n, f) => n + s[f.key].length, 0);
  const options = (k: Key): Array<[string, number]> => {
    const m = counts[k];
    for (const v of s[k]) if (!m.has(v)) m.set(v, 0);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  return (
    <div className="layout">
      <aside className="sidebar sidebar-static" aria-label="Investor filters">
        <div className="sidebar-head">
          <h2>Filters</h2>
          {active > 0 && (
            <button className="link-btn" onClick={reset}>
              Clear all ({active})
            </button>
          )}
        </div>
        {FACETS.map(f => (
          <FilterGroup
            key={f.key}
            title={f.title}
            searchable={f.searchable}
            defaultOpen={f.key === "kind" || f.key === "state"}
            options={options(f.key)}
            selected={s[f.key]}
            labels={f.key === "kind" ? INVESTOR_KIND : f.key === "category" ? CATEGORY_HINT : {}}
            onToggle={v => toggle(f.key, v)}
            onClear={() => set(f.key, [])}
          />
        ))}
      </aside>

      <section className="results" aria-label="Investors">
        <div className="toolbar">
          <SearchBox value={s.q} onChange={v => set("q", v)} placeholder="Search funds by name, city, registration no…" />
        </div>
        <p className="note">
          Every fund on SEBI's public register of Alternative Investment Funds. Type and focus are inferred from the fund's name and SEBI category. Check the fund's own materials before you pitch.
        </p>
        <div className="result-bar">
          <p className="result-meta" aria-live="polite">
            <b>{rows.length.toLocaleString("en-IN")}</b> of {data.investors.length.toLocaleString("en-IN")} funds
          </p>
          <div className="result-actions">
            <label className="sort">
              <span>Sort</span>
              <select value={s.sort} onChange={e => set("sort", e.target.value)}>
                {hits && <option value="relevance">Best match</option>}
                <option value="name">Name A → Z</option>
                <option value="newest">Newest registration</option>
                <option value="oldest">Oldest registration</option>
              </select>
            </label>
            <button
              className="btn btn-ghost"
              disabled={!rows.length}
              onClick={() => downloadCsv(`grantkosh-investors-${data.today}.csv`, rows, ["name", "kind", "category", "registrationNo", "email", "city", "state", "registeredOn", "validUntil"])}
            >
              Export CSV
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <p>No funds match.</p>
            <button className="btn" onClick={reset}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Fund</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Registered</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {page.visible.map(i => (
                  <tr key={i.id}>
                    <td data-label="Fund">
                      <b className="inv-name">{i.name}</b>
                      <span className="inv-sub">
                        {i.category} · {i.registrationNo}
                      </span>
                    </td>
                    <td data-label="Type">
                      <span className={`pill kind-${i.kind}`}>{INVESTOR_KIND[i.kind]}</span>
                    </td>
                    <td data-label="Location">{[i.city, i.state].filter(Boolean).join(", ") || "—"}</td>
                    <td data-label="Registered">{fmtDate(i.registeredOn) || "—"}</td>
                    <td data-label="Contact">{i.email ? <a href={`mailto:${i.email}`}>{i.email}</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.more && (
          <button className="btn btn-wide" onClick={page.showMore}>
            Show more ({page.remaining.toLocaleString("en-IN")} left)
          </button>
        )}
      </section>
    </div>
  );
}
