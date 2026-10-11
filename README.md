# GrantKosh

A free, open directory of **grants, government schemes, challenges, accelerators and investors** for founders.
It has two parts. A polite multi-source scraper collects the data, and a fast React app lets anyone search
and filter it. There is no login, no sign-up and no paywall.

```
scraper/   TypeScript scraper: sources → normalise → validate → dedupe → JSON
web/       React + Vite UI (static, reads web/public/data/*.json)
agent/     Funding Advisor: Gemini-powered chat agent + server (optional)
data/      curated/grants.json (hand-checked entries) and state/ (incremental crawl state)
```

## Quick start

```bash
npm install
npm run dev            # UI at http://localhost:5173 using the committed data
npm run scrape         # refresh every source (≈10 min; first discovery crawl ≈40 min)
npm test               # parser tests against saved fixtures
```

Scraper options:

```bash
npm run scrape -- --list                      # list sources
npm run scrape -- --only birac,idex           # run some sources; others keep their last data
npm run scrape -- --limit 20 --cache          # quick dry run, 20 items per source, cached HTTP
npm run scrape -- --verbose                   # debug logs incl. per-host request stats
```

## Funding Advisor (AI chat)

The **Advisor** tab is a narrow chat agent. A founder describes their startup, and the agent recommends specific
programmes from the directory, including flagship schemes such as **iDEX, DRDO TDF, DST NIDHI (PRAYAS/EIR/SSS),
SISFS, BIRAC BIG, MeitY TIDE/SAMRIDH, AIM and PMEGP**. Each recommendation says why it fits, how much money
it offers, its status, and what to check.

- **Runs on Google Gemini's free tier.** Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Free-tier prompts may be used by Google to improve its products, and the UI tells users so.
- **Grounded.** The model never sees the dataset directly. It calls three tools: `find_programs`, which scores
  programmes against the founder's profile; `get_program`; and `find_investors`. It may cite only ids those tools
  return, and every cited id becomes a clickable card linking to the official page.
- **One matching engine.** Ranking lives in `web/src/match.ts` and is shared by the agent and the browser.
  Scoring covers sector, stage, state rules, founder focus, DPIIT, entity type, equity preference, amount,
  timing, data quality and a flagship boost.
- **Free-tier safe.**
  - Models are tried in order (`gemini-3.8-flash → gemini-3.5-flash-lite → gemini-2.5-flash`), falling back when one is rate-limited.
  - Thinking is kept low, and each answer is capped at 5 tool steps.
  - Per-IP and daily request caps apply.
  - Inputs are validated.
- **Works without AI.** If no key is configured, the quota runs out, or the site is a static host (GitHub Pages),
  the tab switches to **Guided match**: a short form ranked in the browser with the same engine.

Run it:

```bash
cp agent/.env.example agent/.env      # paste GEMINI_API_KEY
npm run dev:agent                     # advisor API on :8787 (Vite proxies /api in dev)
npm run dev                           # UI on :5173
ADVISOR_MOCK=1 npm run dev:agent      # no key? scripted model, real tools, for UI work
npm run build:prod && npm start      # production: serves UI + data + API from one Node process
```

Deployment options are in [DEPLOY.md](DEPLOY.md).

## Sources

| id | What | How |
|---|---|---|
| `curated` | Hand-checked programs in `data/curated/grants.json` | local file, highest priority |
| `birac` | BIRAC / DBT biotech calls for proposals | HTML + detail pages |
| `idex` | Ministry of Defence iDEX challenges (DISC, ADITI, PRIME…) | HTML + detail pages |
| `myscheme` | myScheme.gov.in central & state schemes (business, science/IT, founder-relevant finance, agri, skills, women) | public search API |
| `ukri` | UKRI / Innovate UK funding finder | HTML, paginated |
| `eu-funding` | EU Funding & Tenders: Horizon, EIC, Digital Europe topics + cascade open calls | public search API |
| `grants-gov` | All posted/forecast US federal grants incl. SBIR/STTR | public REST API + details |
| `discovered` | Incubator, CSR, accelerator, state and international programs | see below |
| `sebi-aif` | **Investors**: every SEBI-registered AIF (VC, angel, PE, debt…) | public register |

**Discovery.** `discovered` reads the public grants sitemap of startupgrantsindia.com, which its
robots.txt allows. From each program page it streams only the first ~90 KB and keeps three facts from the
page's schema.org data: program name, funder and official apply link, with tracking parameters removed.
**No descriptions, amounts or other editorial content from that site are stored or published.** Every
other detail comes from the program's own official page. Runs are incremental: a page is re-read only
when its sitemap `lastmod` changes, and an official page only when its cached facts are more than 7 days old.

## Scraper quality

- **Polite by default.** The scraper identifies itself honestly (`GrantKoshBot`) and checks robots.txt for
  every origin. It rate-limits each host (concurrency plus a minimum gap between requests), with a global cap.
- **Resilient.** Transient errors are retried with exponential backoff and jitter, and `Retry-After` is honoured.
  If a source fails, or its record count collapses (a layout change), its **last good data is kept** and
  flagged as stale in `meta.json` and on the Sources page.
- **Validated.** Every record passes a strict zod schema (`scraper/src/core/schema.ts`), which the UI also
  imports for its types. Invalid records are counted and logged, never published.
- **Normalised.** Dates in many formats (`31-10-2026 05:30 PM`, `04 May, 2026`, US month-first),
  money (`₹1.5 Cr`, `25 lakh`, `£2,500`, `$100k`), Indian states and aliases, and a keyword taxonomy for
  industry, stage, founder type, registrations and entity type.
- **Deduplicated** across sources by official URL + title similarity. The higher-priority source wins, gaps
  are filled from the others, and `alsoListedOn` records where else a program appears.
- **Tested** against saved fixtures for every adapter (`scraper/test`).

## The UI

- Search with typo tolerance across title, provider, summary and tags.
- Filters: deadline window, status, stage, program type, funding type, industry, state (with or without
  pan-India), founder type, registrations, entity type, minimum amount, region and source. Each option shows
  a live count.
- Quick chips: closing this month, open now, government, women founders, DPIIT, students, equity-free,
  pan-India, ₹25L+, India-only, international.
- Every view is stored in the URL, so you can share it. CSV export of any filtered list. Dark mode. Works on phones.
- An Investors tab for SEBI-registered funds, with filters by type, category, state and city.

## Deploy

See **[DEPLOY.md](DEPLOY.md)**:
- **Render** — one click from `render.yaml`, free, with the AI advisor.
- **Docker** — via the included `Dockerfile`, for Cloud Run, Fly.io, Railway or a VPS.
- **GitHub Pages** — static, guided matching only.

The production build is `npm run build:prod`, and `npm start` serves the UI, the data and the advisor API from one Node process.

## Data use

`web/public/data/opportunities.json`, `investors.json` and `meta.json` are the whole database. You can use
them as a free API straight from the repo or the deployed site.

## Disclaimer

Not affiliated with any government body. Schemes change their amounts and rules, and open or close without
notice. Always confirm on the official portal before applying.

## License

Code: MIT ([LICENSE](LICENSE)). Data: CC BY 4.0.
