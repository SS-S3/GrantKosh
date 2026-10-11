# Deploying GrantKosh

GrantKosh ships as **one Node process** that serves the React UI, the data files and the Gemini-powered
Funding Advisor API. Production build: `npm run build:prod`. Start: `npm start`. Health check: `GET /api/health`.

| Option | Cost | AI advisor | Effort |
|---|---|---|---|
| **A. Render Starter (recommended, always on)** | US$7/month | Yes | ~10 min, no CLI |
| B. Docker (Google Cloud Run, Fly.io, Railway, any VPS) | Free tiers / cheap | Yes | ~15 min |
| C. GitHub Pages | Free | No (guided matching only) | ~5 min |

---

## 0. Before you start

1. **Push the repo to GitHub.** This folder is its own git repo:
   ```bash
   git add -A && git commit -m "GrantKosh: scraper, UI, advisor, deployment config"
   git remote add origin https://github.com/<you>/grantkosh.git
   git push -u origin main
   ```
2. **Get a free Gemini API key** at <https://aistudio.google.com/apikey>.
   - In Google Cloud Console → APIs & Services → Credentials, **restrict the key** to the *Generative Language API*.
   - Free-tier prompts may be used by Google to improve its products. The advisor UI already tells users this.
   - Free-tier limits are per project and change over time; check them under *Rate limits* in AI Studio.
3. **Let the daily data job push commits:** GitHub → Settings → Actions → General → Workflow permissions →
   *Read and write permissions*.

## A. Render

`render.yaml` uses the **Starter** plan in the **Singapore** region. Starter never sleeps, and each deploy
waits for `/api/health` to pass before it takes traffic, so the daily data redeploy causes no downtime.

1. <https://dashboard.render.com> → **New → Blueprint** → select the repo. Render reads `render.yaml`.
   Add a payment method when Render asks (Starter costs US$7/month).
2. When prompted, paste `GEMINI_API_KEY`. Leave the other variables at their defaults.
3. Wait for the first build (~3–5 min), then open `https://<service>.onrender.com/api/health`:
   ```json
   { "ok": true, "ai": true, "models": ["gemini-3.8-flash", "..."], "dataGeneratedAt": "..." }
   ```
4. Open the site → **Advisor** → ask a starter question.
5. Custom domain: Settings → Custom Domains → add your domain and its `www.` form, then create the DNS
   records that Render shows. Render issues and renews the HTTPS certificate.
6. After the domain works, change `og:image` in `web/index.html` to the absolute URL
   (`https://<your-domain>/brand/og-image.jpg`), so WhatsApp, LinkedIn and X show the logo card.

**Free plan:** set `plan: free` in `render.yaml`. The service then sleeps after ~15 minutes idle, and the first
request after that takes 30–60 seconds. Do not depend on an external pinger to keep it awake.

## Uptime monitoring

Set up an external monitor so you know about an outage before your users do:

1. Create a free account at <https://uptimerobot.com> (or Better Stack).
2. Add an **HTTP(s) – Keyword** monitor: URL `https://<your-domain>/api/health`, keyword `"ok":true`, interval 5 minutes.
3. Add your email (and the mobile app for push alerts) as the alert contact.
4. Optional: publish the free status page and link it from the site footer.

## B. Docker

```bash
docker build -t grantkosh .
docker run -p 8080:8080 -e GEMINI_API_KEY=... grantkosh
```

The image is node:22-alpine, holds only the bundled server and the built site, runs as non-root, and includes a health check.

**Google Cloud Run** (same Google account as the Gemini key; generous free tier):
```bash
gcloud run deploy grantkosh --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars TRUST_PROXY=1 --set-secrets GEMINI_API_KEY=gemini-key:latest \
  --memory 512Mi --min-instances 0 --max-instances 2
```
Create the secret first: `printf '%s' "$KEY" | gcloud secrets create gemini-key --data-file=-`.
To pick up new data, redeploy after the daily data commit, or connect Cloud Build to the repo.

**Fly.io / Railway / VPS:** use the Dockerfile, set `GEMINI_API_KEY` as a secret, set `TRUST_PROXY=1` behind
their proxy, and expose port 8080 (or set `PORT`).

## C. GitHub Pages (static, no AI)

Settings → Pages → Source: *GitHub Actions*. Then Settings → Secrets and variables → Actions → Variables →
add `DEPLOY_PAGES` = `true`. The daily workflow builds and publishes the site. The Advisor tab uses guided
matching in the browser.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | (none) | Enables the AI advisor. Without it the advisor runs in guided mode. |
| `GEMINI_MODELS` | `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-2.5-flash` | Tried in order; falls back when one is rate-limited |
| `ADVISOR_PER_IP_LIMIT` | `12` | Questions per visitor per 10 minutes |
| `ADVISOR_DAILY_LIMIT` | `400` | Questions per server per day; set it below your free-tier daily quota |
| `TRUST_PROXY` | unset | Set to `1` behind a proxy/load balancer, so per-IP limits and HSTS work |
| `PORT` | `8787` (`8080` in Docker) | Listen port; Render and Cloud Run set it automatically |
| `GRANTKOSH_DATA_DIR` | auto | Override where `opportunities.json` and related files are read from |
| `ADVISOR_MOCK` | unset | `1` = scripted fake model, for UI testing without a key. Never set in production. |

## What's already production-ready

- **Server:** a single bundled file (`agent/dist/server.mjs`, no `node_modules` needed at runtime), listening on `0.0.0.0`, with graceful shutdown on SIGTERM.
- **Static files:** precompressed with brotli and gzip (data JSON 7.5 MB → ~0.6 MB). Cache policy: hashed assets cached for a year, data for an hour, `index.html` revalidated. Supports `Last-Modified`/304 and HEAD.
- **Security headers:** strict CSP (self + Google Fonts only), `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, and HSTS behind HTTPS proxies.
- **Request handling:** path-traversal protection, 64 KB body limit, schema-validated chat input, and per-IP and daily rate limits.
- **AI resilience:** model fallback on quota or overload. A rejected key or an outage switches the UI to guided mode.
- **CI** (`.github/workflows/validate.yml`): validate, typecheck, run the 74 tests, production build, a server smoke test, and a Docker build-and-probe.
- **Daily data refresh** (`.github/workflows/scrape.yml`): 06:00 IST scrape, commit, redeploy.

## After launch

- **Monitor quota:** AI Studio → Rate limits. If users often hit "free AI quota is used up", lower
  `ADVISOR_PER_IP_LIMIT` or move to a paid tier.
- **Watch the data job:** the Sources tab shows each source's status. A stale source keeps its last good data,
  and the workflow log shows why it failed.
- **Roll back:** Render → Deploys → *Rollback*; Cloud Run → Revisions.
- **Privacy:** investor emails come from SEBI's public register; contact-person names and street addresses are not
  published. Advisor conversations are not stored by GrantKosh, but on the free tier Google may use them.
