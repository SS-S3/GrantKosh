import type { Dataset } from "./data";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
};

export function SourcesView({ data }: { data: Dataset }) {
  const { meta } = data;
  return (
    <section className="prose">
      <h2>Where the data comes from</h2>
      <p>
        A scraper collects every record from public sources, checks it against a strict schema and removes duplicates across sources. Each listing links to its official page. Last run: <b>{new Date(meta.generatedAt).toLocaleString("en-IN")}</b>.
      </p>
      <div className="table-wrap">
        <table className="src-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Records</th>
              <th>Status</th>
              <th>Last success</th>
            </tr>
          </thead>
          <tbody>
            {meta.sources.map(s => (
              <tr key={s.id}>
                <td data-label="Source">
                  <a href={s.homepage} target="_blank" rel="noopener noreferrer">
                    {s.name}
                  </a>
                  <span className="inv-sub">{s.description}</span>
                </td>
                <td data-label="Records">{s.count.toLocaleString("en-IN")}</td>
                <td data-label="Status">
                  {s.ok ? <span className="pill pill-ok">OK</span> : s.stale ? <span className="pill pill-warn" title={s.error ?? ""}>Stale — kept last run</span> : <span className="pill pill-bad" title={s.error ?? ""}>Failed</span>}
                  {s.error && <span className="inv-sub">{s.error}</span>}
                </td>
                <td data-label="Last success">{ago(s.lastSuccess)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>How to read a listing</h3>
      <ul>
        <li><b>Status</b> is worked out from the program's own dates each time you load the page. "Check dates" means the source gave no dates.</li>
        <li><b>Industry, stage, founder focus and registrations</b> are tagged automatically from the program's own text, unless a human curated the entry (marked <i>Verified</i>).</li>
        <li><b>Amounts</b> show in the source's currency. Filters compare other currencies at approximate INR rates.</li>
        <li>Programs found through discovery keep only their name, funder and official link from the discovery site. Every other detail comes from the program's official page.</li>
      </ul>
      <p className="fine">Not affiliated with any government body. Schemes change their amounts and rules, and open or close without notice. Always confirm on the official portal before applying.</p>
    </section>
  );
}
