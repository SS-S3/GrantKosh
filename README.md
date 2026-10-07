# GrantKosh

A free, open-source directory of grants, schemes, challenges and loans for Indian startups.
No sign-up, no paywall, no tracking — just a JSON file and a static page.

## Why

Most grant information for Indian founders is scattered across ministry portals, incubator sites and
PDFs, or locked behind sign-ups. GrantKosh keeps it in one public, versioned file that anyone can read,
fork, correct or build on.

## Run it locally

```bash
npx serve .          # then open http://localhost:3000
```

(Opening `index.html` straight from disk won't work because browsers block `fetch` on `file://`.)

## Deploy

It's static — drop the folder on GitHub Pages, Netlify, Vercel or Cloudflare Pages. No build step.

After you create the repo, set `REPO` at the top of `assets/app.js` to `your-username/grantkosh`
so the "suggest a correction" links open issues in the right place.

## Use the data

`data/grants.json` is the whole database. Fetch the raw file from GitHub to use it as a free API:

```
https://raw.githubusercontent.com/<you>/grantkosh/main/data/grants.json
```

Each entry looks like:

| field | meaning |
|---|---|
| `id` | kebab-case unique key |
| `type` | `grant` · `challenge` · `loan` · `subsidy` · `fellowship` · `accelerator` · `international` |
| `fundingMin` / `fundingMax` | INR, as numbers (`0` min = no stated floor) |
| `fundingNote` | plain-language summary of the money and its terms |
| `equityFree`, `requiresDPIIT` | booleans |
| `stages` | `idea` · `prototype` · `early-revenue` · `growth` |
| `sectors`, `states` | free tags; `any` / `pan-india` / `international` are special |
| `founderTypes` | `any` · `women` · `sc-st` · `student` · `researcher` |
| `deadline` | `YYYY-MM-DD` or `null` for rolling/periodic |
| `cadence` | how/when it opens |
| `url` | **official** source only |
| `lastVerified`, `verified` | when a maintainer last checked it against the source |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: edit `data/grants.json`, run
`node scripts/validate.mjs`, open a PR with the official link.

## Disclaimer

Not affiliated with any government body. Amounts and rules change — always confirm on the official
portal before applying.

## License

Code: MIT ([LICENSE](LICENSE)). Data in `data/`: CC BY 4.0.
