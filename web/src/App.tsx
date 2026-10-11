import { useEffect, useState } from "react";
import { loadDataset, type Dataset } from "./data";
import { AdvisorView } from "./AdvisorView";
import { FundingView } from "./FundingView";
import { InvestorsView } from "./InvestorsView";
import { SourcesView } from "./SourcesView";
import { useTab } from "./urlState";

const TABS = [
  { id: "funding", label: "Grants", extra: " & schemes" },
  { id: "advisor", label: "Advisor", extra: "" },
  { id: "investors", label: "Investors", extra: "" },
  { id: "sources", label: "Sources", extra: "" },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("gk-theme") ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("gk-theme", next);
    } catch {
      /* private mode */
    }
  };
  return [theme, toggle];
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useTab();
  const [, toggleTheme] = useTheme();

  useEffect(() => {
    loadDataset().then(setData, e => setError((e as Error).message));
  }, []);

  const openNow = data?.opportunities.filter(o => o.status === "open" || o.status === "rolling").length ?? 0;

  return (
    <>
      <header className="masthead">
        <div className="wrap masthead-row">
          <a className="brand" href="./">
            <img className="brand-mark" src="brand/mark.png" width="36" height="36" alt="" />
            <span className="brand-word">Grant<span>Kosh</span></span>
          </a>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                {t.label}
                {t.extra && <span className="tab-extra">{t.extra}</span>}
                {data && (t.id === "funding" || t.id === "investors") && <span className="tab-count">{(t.id === "funding" ? data.opportunities.length : data.investors.length).toLocaleString("en-IN")}</span>}
              </button>
            ))}
          </nav>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
            ◐
          </button>
        </div>
      </header>

      <main className="wrap">
        {tab === "funding" && (
          <section className="hero">
            <p className="eyebrow">Free · Open data · No sign-up</p>
            <h1>Every grant, scheme and challenge for founders, in one search.</h1>
            {data && (
              <div className="stats">
                <div className="stat"><b>{data.opportunities.length.toLocaleString("en-IN")}</b><span>programs tracked</span></div>
                <div className="stat"><b>{openNow.toLocaleString("en-IN")}</b><span>open or rolling now</span></div>
                <div className="stat"><b>{data.investors.length.toLocaleString("en-IN")}</b><span>registered investors</span></div>
                <div className="stat"><b>{data.meta.sources.length}</b><span>sources, refreshed {new Date(data.meta.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></div>
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="empty">
            <p>{error}</p>
          </div>
        )}
        {!data && !error && <div className="loading" aria-busy="true">Loading directory…</div>}
        {data && tab === "funding" && <FundingView data={data} />}
        {data && tab === "advisor" && <AdvisorView data={data} />}
        {data && tab === "investors" && <InvestorsView data={data} />}
        {data && tab === "sources" && <SourcesView data={data} />}
      </main>

      <footer className="wrap footer">
        <span>Data: CC BY 4.0 · Code: MIT · Not affiliated with any government body.</span>
        <span>
          <a href={`${import.meta.env.BASE_URL}data/opportunities.json`}>opportunities.json</a> · <a href={`${import.meta.env.BASE_URL}data/investors.json`}>investors.json</a>
        </span>
      </footer>
    </>
  );
}
