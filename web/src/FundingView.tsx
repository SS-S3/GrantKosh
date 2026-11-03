import { useEffect, useMemo, useState } from "react";
import { FilterGroup, Modal, SearchBox, usePaged } from "./components";
import { loadOpportunity, type PublicOpportunity, type Stats } from "./data";
import { amountLabel, deadlineLabel, fmtDate } from "./format";
import {
  activeFilterCount, FACETS, FUNDING_DEFAULTS, MIN_AMOUNT, QUICK, SORTS, WITHIN, type FacetKey,
} from "./funding";
import {
  COUNTRY, ENTITY, FOUNDER, FUNDING_TYPE, label, PROGRAM_TYPE, REGISTRATION, SECTOR, STAGE, STATES, STATUS,
} from "./labels";
import { toQuery } from "./query";
import { useUrlState } from "./urlState";

export function FundingView({ stats }: { stats: Stats }) {
  const { state: s, set, toggle, reset } = useUrlState(FUNDING_DEFAULTS, ["tab", "open"]);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(location.search).get("open"));
  const [drawer, setDrawer] = useState(false);

  const query = useMemo(() => toQuery(s, FUNDING_DEFAULTS).toString(), [s]);
  const list = usePaged<PublicOpportunity, FacetKey>("funding", query);
  const searching = list.page?.searching ?? !!s.q.trim();
  const sort = list.page?.sort ?? (s.sort || (s.q.trim() ? "relevance" : "closing"));
  const active = activeFilterCount(s);
  const [selected, setSelected] = useState<PublicOpportunity | null>(null);
  useEffect(() => {
    if (!openId) return setSelected(null);
    const shown = list.items.find(o => o.id === openId);
    if (shown) return setSelected(shown);
    // Opened from a shared link: fetch the one programme.
    let live = true;
    loadOpportunity(openId).then(o => live && setSelected(o), () => live && setSelected(null));
    return () => {
      live = false;
    };
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = (key: FacetKey): Array<[string, number]> => {
    const f = FACETS.find(x => x.key === key)!;
    const entries = [...(list.page?.counts[key] ?? s[key].map(v => [v, 0] as [string, number]))];
    if (f.order) return entries.sort((a, b) => f.order!.indexOf(a[0]) - f.order!.indexOf(b[0]));
    return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const open = (id: string | null) => {
    setOpenId(id);
    const p = new URLSearchParams(location.search);
    if (id) p.set("open", id);
    else p.delete("open");
    history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  };

  return (
    <div className="layout">
      <aside className={`sidebar${drawer ? " is-open" : ""}`} aria-label="Filters">
        <div className="sidebar-head">
          <h2>Filters</h2>
          {active > 0 && (
            <button className="link-btn" onClick={reset}>
              Clear all ({active})
            </button>
          )}
          <button className="sidebar-close" onClick={() => setDrawer(false)} aria-label="Close filters">
            ×
          </button>
        </div>

        <div className="fgroup fgroup-static">
          <div className="fgroup-title">Deadline</div>
          <div className="radio-list">
            {WITHIN.map(w => (
              <label key={w.value} className="fopt">
                <input type="radio" name="within" checked={s.within === w.value} onChange={() => set("within", w.value)} />
                <span className="fopt-label">{w.label}</span>
              </label>
            ))}
          </div>
        </div>

        {FACETS.filter(f => f.key !== "country").map(f => (
          <FilterGroup
            key={f.key}
            title={f.title}
            hint={f.hint}
            searchable={f.searchable}
            defaultOpen={f.key === "status" || f.key === "stage"}
            options={options(f.key)}
            selected={s[f.key]}
            labels={f.labels}
            onToggle={v => toggle(f.key, v)}
            onClear={() => set(f.key, [])}
          >
            {f.key === "state" && (
              <label className="fopt fopt-switch">
                <input type="checkbox" checked={s.nationwide === "1"} onChange={e => set("nationwide", e.target.checked ? "1" : "0")} />
                <span className="fopt-label">Include pan-India programs</span>
              </label>
            )}
          </FilterGroup>
        ))}

        <div className="fgroup fgroup-static">
          <div className="fgroup-title">Minimum amount</div>
          <select value={s.min} onChange={e => set("min", e.target.value)} aria-label="Minimum amount">
            {MIN_AMOUNT.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="fhint">Other currencies are compared at approximate INR rates.</p>
        </div>

        <FilterGroup title="Region" options={options("country")} selected={s.country} labels={COUNTRY} onToggle={v => toggle("country", v)} onClear={() => set("country", [])} />
      </aside>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <section className="results" aria-label="Funding opportunities">
        <div className="toolbar">
          <SearchBox value={s.q} onChange={v => set("q", v)} placeholder="Search grants, schemes, ministries, sectors…" />
          <button className="btn filters-btn" onClick={() => setDrawer(true)}>
            Filters{active ? ` (${active})` : ""}
          </button>
        </div>

        <div className="chips" role="group" aria-label="Quick filters">
          {QUICK.map(q => (
            <button key={q.id} className="chip" aria-pressed={s.quick.includes(q.id)} onClick={() => toggle("quick", q.id)}>
              {q.label}
            </button>
          ))}
        </div>

        <div className="result-bar">
          <p className="result-meta" aria-live="polite">
            <b>{list.total.toLocaleString("en-IN")}</b> of {stats.programs.toLocaleString("en-IN")} programs
          </p>
          <div className="result-actions">
            <label className="sort">
              <span>Sort</span>
              <select value={sort} onChange={e => set("sort", e.target.value)}>
                {SORTS.filter(x => x.value !== "relevance" || searching).map(x => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {list.error ? (
          <div className="empty">
            <p>{list.error}</p>
          </div>
        ) : !list.page ? (
          <div className="loading" aria-busy="true">Loading programmes…</div>
        ) : list.total === 0 ? (
          <div className="empty">
            <p>No programs match these filters.</p>
            <button className="btn" onClick={reset}>
              Clear filters
            </button>
          </div>
        ) : (
          <ol className={`cards${list.loading ? " is-loading" : ""}`}>
            {list.items.map(o => (
              <OppCard key={o.id} o={o} today={stats.today} onOpen={() => open(o.id)} />
            ))}
          </ol>
        )}
        {list.remaining > 0 && !list.error && (
          <button className="btn btn-wide" onClick={list.loadMore} disabled={list.loading}>
            {list.loading ? "Loading…" : `Show more (${list.remaining.toLocaleString("en-IN")} left)`}
          </button>
        )}
      </section>

      <Modal open={!!selected} onClose={() => open(null)} labelledBy="opp-title">
        {selected && <OppDetail o={selected} today={stats.today} />}
      </Modal>
    </div>
  );
}

export function OppCard({ o, today, onOpen }: { o: PublicOpportunity; today: string; onOpen: () => void }) {
  const dl = deadlineLabel(o, today);
  const amount = amountLabel(o);
  return (
    <li className={`card status-${o.status}`}>
      <button className="card-hit" onClick={onOpen} aria-label={`Open details for ${o.title}`} />
      <div className="card-main">
        <div className="card-kicker">
          <span className="pill pill-type">{PROGRAM_TYPE[o.programType]}</span>
          {o.equityFree && <span className="pill pill-ok">Equity-free</span>}
          {o.verified && <span className="pill pill-ok" title={`Checked against the official source on ${o.lastVerified}`}>Verified</span>}
          <span className="kicker-text">{COUNTRY[o.country]}</span>
        </div>
        <h3>{o.title}</h3>
        {o.provider && <p className="by">by {o.provider}</p>}
        {o.summary && <p className="summary">{o.summary}</p>}
        <div className="tags">
          {o.states.filter(x => x !== "pan-india").slice(0, 2).map(x => <span key={x} className="tag">{label(STATES, x)}</span>)}
          {o.sectors.filter(x => x !== "any").slice(0, 3).map(x => <span key={x} className="tag">{label(SECTOR, x)}</span>)}
          {o.founderTypes.slice(0, 2).map(x => <span key={x} className="tag tag-accent">{FOUNDER[x]}</span>)}
          {o.registrations.includes("dpiit") && <span className="tag">DPIIT required</span>}
        </div>
      </div>
      <div className="card-side">
        <span className={`deadline tone-${dl.tone}`}>{dl.text}</span>
        {amount ? <b className="amount">{amount}</b> : <span className="amount amount-none">Amount not stated</span>}
      </div>
    </li>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="drow">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OppDetail({ o, today }: { o: PublicOpportunity; today: string }) {
  const dl = deadlineLabel(o, today);
  const list = (xs: string[], map: Record<string, string>) => (xs.length ? xs.map(x => label(map, x)).join(", ") : "—");
  return (
    <article>
      <div className="card-kicker">
        <span className="pill pill-type">{PROGRAM_TYPE[o.programType]}</span>
        <span className={`pill status-pill status-${o.status}`}>{STATUS[o.status]}</span>
        {o.verified && <span className="pill pill-ok">Verified {fmtDate(o.lastVerified)}</span>}
      </div>
      <h2 id="opp-title">{o.title}</h2>
      {o.provider && <p className="by">by {o.provider}</p>}
      {o.summary && <p>{o.summary}</p>}

      <div className="cta-row">
        <a className="btn btn-primary" href={o.url} target="_blank" rel="noopener noreferrer">
          Official page ↗
        </a>
        {o.applyUrl && (
          <a className="btn" href={o.applyUrl} target="_blank" rel="noopener noreferrer">
            Apply / guidelines ↗
          </a>
        )}
      </div>

      <dl className="dlist">
        <Row k="Funding">{amountLabel(o) || "Not stated on the source"} · {FUNDING_TYPE[o.fundingType]}</Row>
        <Row k="Dates">
          <span className={`tone-${dl.tone}`}>{dl.text}</span>
          {o.opensAt && o.status !== "upcoming" ? ` · opened ${fmtDate(o.opensAt)}` : ""}
          {o.cadence ? ` · ${o.cadence}` : ""}
        </Row>
        <Row k="Where">{o.country === "IN" ? list(o.states, STATES) : COUNTRY[o.country]}</Row>
        <Row k="Industry">{list(o.sectors, SECTOR)}</Row>
        <Row k="Stage">{list(o.stages, STAGE)}</Row>
        <Row k="Founder focus">{list(o.founderTypes, FOUNDER)}</Row>
        <Row k="Registrations">{list(o.registrations, REGISTRATION)}</Row>
        <Row k="Entity types">{list(o.entityTypes, ENTITY)}</Row>
        {o.tags.length > 0 && <Row k="Tags">{o.tags.join(", ")}</Row>}
      </dl>

      {o.eligibility.length > 0 && (
        <>
          <h4>Eligibility</h4>
          <ul className="elig">
            {o.eligibility.map(e => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}

      <p className="fine">
        Listed since {fmtDate(o.firstSeen)} · last checked {fmtDate(o.lastSeen)}.
        {o.confidence !== "high" &&
          " Some details (industry, stage, audience, amount, dates) were inferred from the program's own page text. Confirm them on the official page before applying."}
      </p>
    </article>
  );
}
