import { useMemo, useState } from "react";
import { FilterGroup, Modal, SearchBox, useShowMore } from "./components";
import { downloadCsv } from "./csv";
import type { Dataset } from "./data";
import { amountLabel, deadlineLabel, fmtDate } from "./format";
import {
  activeFilterCount, applyFunding, FACETS, FUNDING_DEFAULTS, MIN_AMOUNT, QUICK, SORTS, WITHIN, type FacetKey,
} from "./funding";
import {
  COUNTRY, ENTITY, FOUNDER, FUNDING_TYPE, label, PROGRAM_TYPE, REGISTRATION, SECTOR, STAGE, STATES, STATUS,
} from "./labels";
import type { Opportunity } from "./types";
import { useUrlState } from "./urlState";

export function FundingView({ data }: { data: Dataset }) {
  const { state: s, set, toggle, reset } = useUrlState(FUNDING_DEFAULTS, ["tab", "open"]);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(location.search).get("open"));
  const [drawer, setDrawer] = useState(false);

  const sourceNames = useMemo(() => Object.fromEntries(data.meta.sources.map(x => [x.id, x.name])), [data.meta]);
  const hits = useMemo(() => {
    const q = s.q.trim();
    if (!q) return null;
    return new Map(data.oppIndex.search(q).map(r => [r.id as string, r.score]));
  }, [s.q, data.oppIndex]);
  const sort = !s.sort || (s.sort === "relevance" && !hits) ? (hits ? "relevance" : "closing") : s.sort;
  const { rows, counts } = useMemo(() => applyFunding(data.opportunities, { ...s, sort }, data.today, hits), [data, s, sort, hits]);
  const page = useShowMore(rows, 30, JSON.stringify(s));
  const active = activeFilterCount(s);
  const selected = openId ? data.opportunities.find(o => o.id === openId) ?? null : null;

  const options = (key: FacetKey): Array<[string, number]> => {
    const f = FACETS.find(x => x.key === key)!;
    const m = counts[key];
    for (const v of s[key]) if (!m.has(v)) m.set(v, 0);
    const entries = [...m.entries()];
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

  const exportCsv = () =>
    downloadCsv(`grantkosh-funding-${data.today}.csv`, rows, [
      "title", "provider", "programType", "fundingType", "status", "deadline", "opensAt", "amountMin", "amountMax", "currency",
      "country", "states", "sectors", "stages", "founderTypes", "registrations", "url", "source",
    ]);

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

        {FACETS.filter(f => f.key !== "source" && f.key !== "country").map(f => (
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
        <FilterGroup title="Source" options={options("source")} selected={s.source} labels={sourceNames} onToggle={v => toggle("source", v)} onClear={() => set("source", [])} />
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
            <b>{rows.length.toLocaleString("en-IN")}</b> of {data.opportunities.length.toLocaleString("en-IN")} programs
          </p>
          <div className="result-actions">
            <label className="sort">
              <span>Sort</span>
              <select value={sort} onChange={e => set("sort", e.target.value)}>
                {SORTS.filter(x => x.value !== "relevance" || hits).map(x => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <p>No programs match these filters.</p>
            <button className="btn" onClick={reset}>
              Clear filters
            </button>
          </div>
        ) : (
          <ol className="cards">
            {page.visible.map(o => (
              <OppCard key={o.id} o={o} today={data.today} sourceName={sourceNames[o.source] ?? o.source} onOpen={() => open(o.id)} />
            ))}
          </ol>
        )}
        {page.more && (
          <button className="btn btn-wide" onClick={page.showMore}>
            Show more ({page.remaining.toLocaleString("en-IN")} left)
          </button>
        )}
      </section>

      <Modal open={!!selected} onClose={() => open(null)} labelledBy="opp-title">
        {selected && <OppDetail o={selected} today={data.today} sourceNames={sourceNames} />}
      </Modal>
    </div>
  );
}

export function OppCard({ o, today, sourceName, onOpen }: { o: Opportunity; today: string; sourceName: string; onOpen: () => void }) {
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
        <span className="src">{sourceName}</span>
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

export function OppDetail({ o, today, sourceNames }: { o: Opportunity; today: string; sourceNames: Record<string, string> }) {
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
        Source: {sourceNames[o.source] ?? o.source}
        {o.alsoListedOn.length > 0 && ` · also listed on ${o.alsoListedOn.map(x => sourceNames[x] ?? x).join(", ")}`} · first seen {fmtDate(o.firstSeen)} · last seen {fmtDate(o.lastSeen)}.
        {o.confidence !== "high" &&
          " Some details (industry, stage, audience, amount, dates) were inferred from the program's own page text. Confirm them on the official page before applying."}
      </p>
    </article>
  );
}
