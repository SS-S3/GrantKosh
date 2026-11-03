import { useEffect, useState } from "react";
import { AccountMenu } from "./account";
import { loadStats, type Stats } from "./data";
import { AdvisorView } from "./AdvisorView";
import { FundingView } from "./FundingView";
import { InvestorsView } from "./InvestorsView";
import { LegalLinks, LegalPageView, legalPageFromPath } from "./LegalPages";
import { useTab } from "./urlState";

const TABS = [
  { id: "funding", label: "Grants", extra: " & schemes" },
  { id: "advisor", label: "Advisor", extra: "" },
  { id: "investors", label: "Investors", extra: "" },
];

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** Light or dark: follows the system until the visitor picks one, then remembers the choice. */
function useTheme(): ["light" | "dark", () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("gk-theme") ?? "";
    } catch {
      return "";
    }
  });
  const [system, setSystem] = useState(systemDark);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystem(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const current = theme === "light" || theme === "dark" ? theme : system ? "dark" : "light";
  const toggle = () => {
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("gk-theme", next);
    } catch {
      /* private mode */
    }
  };
  return [current, toggle];
}

export default function App() {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useTab();
  const [theme, toggleTheme] = useTheme();
  // Policy pages live at their own paths (/terms, /privacy, …), which payment gateways link to.
  const [legal] = useState(() => legalPageFromPath(location.pathname));
  const openTab = (t: string) => (legal ? location.assign(t === "funding" ? "/" : `/?tab=${t}`) : setTab(t));

  useEffect(() => {
    loadStats().then(setData, e => setError((e as Error).message));
  }, []);

  return (
    <>
      <header className="masthead">
        <div className="wrap masthead-row">
          <a className="brand" href="./">
            <img className="brand-mark" src="brand/mark.png" width="36" height="36" alt="" />
            <span className="brand-word">Grant<span>Kosh</span></span>
          </a>
          <span className="maker" title="Made by Vektor Dynamics">
            <span className="maker-by">by</span>
            <img className="vd-light" src="brand/vektor-mark-light.png" width="29" height="22" alt="" />
            <img className="vd-dark" src="brand/vektor-mark-dark.png" width="29" height="22" alt="" />
            <span className="maker-name">Vektor Dynamics</span>
          </span>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={!legal && tab === t.id} className="tab" onClick={() => openTab(t.id)}>
                {t.label}
                {t.extra && <span className="tab-extra">{t.extra}</span>}
                {data && (t.id === "funding" || t.id === "investors") && <span className="tab-count">{(t.id === "funding" ? data.programs : data.investors).toLocaleString("en-IN")}</span>}
              </button>
            ))}
          </nav>
          <AccountMenu />
          <button className="icon-btn theme-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" fill="currentColor" />
                <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="wrap">
        {legal && <LegalPageView page={legal} />}
        {!legal && tab === "funding" && (
          <section className="hero">
            <p className="eyebrow">Free · Updated daily · No sign-up</p>
            <h1>Every grant, scheme and challenge for founders, in one search.</h1>
            {data && (
              <div className="stats">
                <div className="stat"><b>{data.programs.toLocaleString("en-IN")}</b><span>programs tracked</span></div>
                <div className="stat"><b>{data.openNow.toLocaleString("en-IN")}</b><span>open or rolling now</span></div>
                <div className="stat"><b>{data.investors.toLocaleString("en-IN")}</b><span>registered investors</span></div>
                <div className="stat"><b>{new Date(data.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</b><span>last updated</span></div>
              </div>
            )}
          </section>
        )}

        {!legal && error && (
          <div className="empty">
            <p>{error}</p>
          </div>
        )}
        {!legal && !data && !error && <div className="loading" aria-busy="true">Loading directory…</div>}
        {!legal && data && tab === "funding" && <FundingView stats={data} />}
        {!legal && data && tab === "advisor" && <AdvisorView stats={data} />}
        {!legal && data && tab === "investors" && <InvestorsView stats={data} />}
      </main>

      <footer className="wrap footer">
        <span>
          © GrantKosh · Not affiliated with any government body. Always confirm details on the official page.
          <LegalLinks />
        </span>
        <span className="footer-maker">
          <span>Made by</span>
          <img className="vd-light" src="brand/vektor-light.png" width="113" height="56" alt="Vektor Dynamics — Drive the change" />
          <img className="vd-dark" src="brand/vektor-dark.png" width="122" height="56" alt="Vektor Dynamics — Drive the change" />
        </span>
      </footer>
    </>
  );
}
