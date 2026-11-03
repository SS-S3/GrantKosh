import { useMemo } from "react";
import { FilterGroup, SearchBox, usePaged } from "./components";
import type { PublicInvestor, Stats } from "./data";
import { fmtDate } from "./format";
import { INVESTOR_DEFAULTS as DEFAULTS, INVESTOR_FACETS as FACETS, type InvestorKey as Key } from "./investors";
import { INVESTOR_KIND } from "./labels";
import { toQuery } from "./query";
import { useUrlState } from "./urlState";

const CATEGORY_HINT: Record<string, string> = {
  "AIF Category I": "AIF Category I (VC, angel, SME, social)",
  "AIF Category II": "AIF Category II (PE, debt, VC)",
  "AIF Category III": "AIF Category III (hedge, listed)",
};

export function InvestorsView({ stats }: { stats: Stats }) {
  const { state: s, set, toggle, reset } = useUrlState(DEFAULTS, ["tab"]);
  const query = useMemo(() => toQuery(s, DEFAULTS).toString(), [s]);
  const list = usePaged<PublicInvestor, Key>("investors", query);
  const hits = list.page?.searching ?? !!s.q.trim();

  const active = FACETS.reduce((n, f) => n + s[f.key].length, 0);
  const options = (k: Key): Array<[string, number]> => {
    return [...(list.page?.counts[k] ?? s[k].map(v => [v, 0] as [string, number]))].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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
          SEBI-registered Alternative Investment Funds. Type and focus are inferred from each fund's name and category. Check the fund's own materials before you pitch.
        </p>
        <div className="result-bar">
          <p className="result-meta" aria-live="polite">
            <b>{list.total.toLocaleString("en-IN")}</b> of {stats.investors.toLocaleString("en-IN")} funds
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
          </div>
        </div>

        {list.error ? (
          <div className="empty">
            <p>{list.error}</p>
          </div>
        ) : !list.page ? (
          <div className="loading" aria-busy="true">Loading funds…</div>
        ) : list.total === 0 ? (
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
                {list.items.map(i => (
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
        {list.remaining > 0 && !list.error && (
          <button className="btn btn-wide" onClick={list.loadMore} disabled={list.loading}>
            {list.loading ? "Loading…" : `Show more (${list.remaining.toLocaleString("en-IN")} left)`}
          </button>
        )}
      </section>
    </div>
  );
}
