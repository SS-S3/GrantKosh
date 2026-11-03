# Deploying GrantKosh

GrantKosh ships as **one Node process** that serves the React UI, the data files and the Gemini-powered
Funding Advisor API. Production build: `npm run build:prod`. Start: `npm start`. Health check: `GET /api/health`. On Vercel the UI is served from the CDN and the API runs as serverless functions.

| Option | Cost | AI advisor | Effort |
|---|---|---|---|
| **Vercel (recommended, always on)** | Pro plan once you charge subscriptions | Yes | ~15 min, no CLI |
| Oracle Cloud Always Free VM (always on) | Free | Yes | ~45 min, SSH |
| A. Render free + keep-awake monitor | Free | Yes | ~15 min, no CLI |
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

## Vercel (always on)

Vercel serves the site and the data from its CDN, and runs the Advisor API as two serverless functions
(`/api/health`, `/api/chat`). `vercel.json` runs `npm run build:vercel`, which builds the site and writes a
[Build Output](https://vercel.com/docs/build-output-api/v3) to `.vercel/output/` with
`scripts/vercel-output.mjs`. Static pages never sleep. A function that has been idle starts cold, which adds
a short delay to the first Advisor answer only.

**Plan:** Hobby (free) is for non-commercial use only. Selling Advisor subscriptions is commercial use, so
switch the project to **Pro** before you start charging (the free trial period can run on Hobby only if
nothing is sold yet).

### 1. Import the project

1. <https://vercel.com/new> → import the GitHub repo. Leave *Framework Preset* as **Other** and leave the
   build settings empty: `vercel.json` sets them.
2. Settings → Environment Variables → add `GEMINI_API_KEY` (Production). Optional: `GEMINI_MODELS`,
   `ADVISOR_PER_IP_LIMIT`, `ADVISOR_DAILY_LIMIT`. Do not set `TRUST_PROXY`: the functions detect Vercel.
3. Settings → Functions → Function Region → **Mumbai (bom1)**, closest to Indian users.
4. Deploy, then open `https://<project>.vercel.app/api/health` and check for `"ai":true`.

### 2. Shared rate limits (Upstash Redis)

Each function instance has its own memory, so in-memory counters do not hold across instances. Without
shared counters, `ADVISOR_DAILY_LIMIT` is not enforced and visitors can use up your Gemini free quota.

1. Project → **Storage** → Create Database → **Upstash for Redis** (free plan), region Mumbai if offered.
2. Connect it to the project for all environments. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
   (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from a database you create at upstash.com also work.)
3. Redeploy so the functions read the new variables.

If Redis is unreachable, the functions log `[limits] Redis unavailable` and fall back to per-instance limits.

### 3. Accounts, trial and subscriptions

The directory, investors and sources stay free and need no account. The **Advisor chat** needs sign-in:

| Plan | Who | Chats per day (resets midnight IST) |
|---|---|---|
| Free | any signed-in account | `ADVISOR_FREE_DAILY` = 2 |
| Trial | accounts created before `TRIAL_SIGNUP_DEADLINE` (25 Nov 2026, 00:00 IST), for `TRIAL_DAYS` = 30 days after sign-up | `ADVISOR_PAID_DAILY` = 15 |
| Paid | active ₹101/month subscription | `ADVISOR_PAID_DAILY` = 15 |

**Clerk (sign-in):**
1. Create an application at <https://dashboard.clerk.com>; enable Google and email code sign-in.
2. Vercel env vars: `VITE_CLERK_PUBLISHABLE_KEY` (used at build time, so redeploy after setting it) and
   `CLERK_SECRET_KEY`. Optional: `CLERK_AUTHORIZED_PARTIES=https://<your-domain>`, `CLERK_JWT_KEY` (PEM) for
   networkless token checks.
3. For production, create the Clerk production instance and add its DNS records (`clerk.<your-domain>`).
   The CSP picks up the Clerk origin from the publishable key automatically.

**Cashfree (subscriptions):**
1. Cashfree dashboard → Subscriptions → create a **Periodic** plan: ₹101, every 1 month. Copy its plan id.
2. Vercel env vars: `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_PLAN_ID`,
   `CASHFREE_ENV` (`sandbox` until you have tested, then `production`), and `PUBLIC_URL=https://<your-domain>`.
3. Developers → Webhooks → add `https://<your-domain>/api/billing/webhook` for subscription events.
   If Cashfree gives a separate webhook secret, set `CASHFREE_WEBHOOK_SECRET`; otherwise the client secret is used.
4. Test in sandbox: subscribe from the Advisor tab, approve the mandate, and check that the plan bar shows
   *Subscribed*. Logs show `[billing] SUBSCRIPTION_STATUS_CHANGED … paid until …`.

How access works: when the mandate becomes active, access runs until 2 days after the first charge date.
Each successful monthly charge extends it to 33 days from the charge. A trial user who subscribes is first
charged when the trial ends. A cancelled or failed subscription is not extended, and access lapses on its own.
Paid-until dates live in each Clerk user's public metadata (Clerk dashboard → Users → user → Metadata).

**Gemini: use a paid key.** The free tier's daily request quota is far below what trial users need, and on
the free tier Google may use prompts to improve its products, which paying customers should not get. In AI Studio,
enable billing on the key's project (Tier 1). Then edit the fine print at the bottom of the chat in
`web/src/AdvisorView.tsx`, which still says the free tier is used.

### Rate limits and cost

One Advisor answer makes 1–5 Gemini calls (tool use). Estimate ~15k input and ~1.5k output tokens, about
₹0.7 on a Flash model. Check current prices in AI Studio and adjust.

| Limit | Default | Why |
|---|---|---|
| `ADVISOR_FREE_DAILY` | 2 per account per day | Lets people try it; costs at most ~₹1.4 a day per free user |
| `ADVISOR_PAID_DAILY` | 15 per account per day | A heavy user (15 × 30 = 450 chats) costs ~₹300 a month, but typical use is a few chats a week. ₹101 minus 18% GST and ~2% gateway fee leaves ~₹84, which covers ~120 chats a month. Lower it if heavy users appear. |
| `ADVISOR_FREE_POOL_DAILY` | 300 per day, all free users together | Caps free-tier spend at ~₹210 a day, so free users cannot use up the budget meant for paying users |
| `ADVISOR_DAILY_LIMIT` | 2000 per day, everyone | Hard ceiling under your Gemini quota and budget. Counted per Gemini day (midnight Pacific), when Google resets quotas |
| `ADVISOR_PER_IP_LIMIT` | 12 per IP per 10 min | Stops scripts before any account lookup |

Set a budget alert on the Google Cloud project as well. The limits need Upstash Redis on Vercel (step 2).

### 4. Domain and daily data

1. Settings → Domains → add your domain and its `www.` form, then create the DNS records Vercel shows.
   Vercel issues the HTTPS certificate.
2. Change `og:image` in `web/index.html` to `https://<your-domain>/brand/og-image.jpg` and push.
3. Vercel deploys every push to `main`, including the bot's daily data commit, so new data goes live after
   each scrape. No workflow change is needed.
4. Add an UptimeRobot keyword monitor on `/api/health` (see "Keep the free service awake" below; on Vercel
   it is only for down alerts, so a 15-minute interval is enough).

To check the build output locally: `npm run build:vercel`, then look in `.vercel/output/`.

## Oracle Cloud Always Free (always on)

One small VM runs two containers from `deploy/oracle/`: the app, and Caddy in front of it for automatic
HTTPS. GitHub Actions (`.github/workflows/image.yml`) builds an amd64 + arm64 image to
`ghcr.io/<owner>/<repo>` on every push and after each daily scrape. The VM checks for a new image every
15 minutes and restarts the app. Caddy holds requests during that restart, so visitors see no error.

### 1. Oracle account

1. Sign up at <https://signup.cloud.oracle.com>. Choose **India South (Hyderabad)** or **India West (Mumbai)**
   as the home region. You cannot change the home region later, and Always Free compute runs only there.
   Oracle asks for a card to verify the account.
2. **Upgrade to Pay As You Go:** ☰ → Billing & Cost Management → Upgrade and Manage Payment.
   Always Free resources stay free. Without this upgrade, Oracle can reclaim an Always Free VM that stays idle
   (low CPU for 7 days), and a directory site is idle most of the time.
3. Create a budget so you hear about any charge: Billing → Budgets → Create Budget, amount `1` (USD),
   alert at 1% of actual spend.

### 2. Create the VM

Compute → Instances → **Create instance**:

| Setting | Value |
|---|---|
| Image | Canonical **Ubuntu 24.04** |
| Shape | Ampere **VM.Standard.A1.Flex**, 1 OCPU, 6 GB (Always Free). On "Out of capacity", retry later, try another availability domain, or use **VM.Standard.E2.1.Micro** (AMD). |
| Networking | Create a new VCN with a **public subnet**, and assign a public IPv4 address |
| SSH keys | Upload your public key, for example `~/.ssh/id_ed25519.pub` (create one with `ssh-keygen -t ed25519`) |

Note the instance's **public IP**. It stays the same for the life of the instance. To keep the same IP if you
ever rebuild the VM, convert it to a reserved public IP (Networking → Reserved public IPs; also free).

### 3. Open ports 80 and 443

Networking → Virtual cloud networks → your VCN → **Security Lists** → Default Security List →
**Add Ingress Rules** (source CIDR `0.0.0.0/0`):

| Protocol | Destination port |
|---|---|
| TCP | 80 |
| TCP | 443 |
| UDP | 443 |

`setup.sh` opens the same ports in the VM's own firewall.

### 4. Domain

At your domain registrar, create A records for `@` and `www` pointing at the VM's public IP. Wait until
`dig +short <your-domain>` returns that IP. Caddy cannot get a certificate before DNS points at the VM.

### 5. Container image

1. Push the repo to GitHub. The **Build image** workflow runs and publishes `ghcr.io/<owner>/<repo>`.
   Run it by hand from the Actions tab if needed.
2. GitHub → your profile → **Packages** → the package → Package settings → **Change visibility → Public**.
   If you keep it private, run `sudo docker login ghcr.io` on the VM with a personal access token
   that has only the `read:packages` scope.

### 6. Install on the VM

On your Mac, from the repo root:

```bash
cp deploy/oracle/.env.example deploy/oracle/.env
```

Edit `deploy/oracle/.env`: set `DOMAIN`, `IMAGE` (lowercase) and `GEMINI_API_KEY`. Git ignores this file.

```bash
scp -r deploy/oracle ubuntu@<vm-ip>:~/grantkosh
```

```bash
ssh ubuntu@<vm-ip> 'sudo ~/grantkosh/setup.sh'
```

The script opens the firewall, adds swap on 1 GB shapes, installs Docker from Ubuntu's repositories, copies
the files to `/opt/grantkosh`, starts the containers and enables the `grantkosh-update.timer`.
It is safe to run again, for example after you change `.env`.

### 7. Check

```bash
curl -fsS https://<your-domain>/api/health
```

Then change `og:image` in `web/index.html` to `https://<your-domain>/brand/og-image.jpg` and push.
Add an UptimeRobot keyword monitor on `/api/health` (see below) so you get an alert if the VM goes down.

### Operating the VM

| Task | Command (on the VM) |
|---|---|
| Logs | `cd /opt/grantkosh && sudo docker compose logs -f app` |
| Update now | `sudo systemctl start grantkosh-update` |
| Last update runs | `journalctl -u grantkosh-update -n 50` |
| Roll back | set `IMAGE=ghcr.io/<owner>/<repo>:sha-<commit>` in `/opt/grantkosh/.env`, then `cd /opt/grantkosh && sudo docker compose up -d` |
| Change a setting | edit `/opt/grantkosh/.env`, then `cd /opt/grantkosh && sudo docker compose up -d` |

Ubuntu installs security updates automatically (`unattended-upgrades`). Reboot now and then for kernel
updates: `sudo reboot`. Docker and both containers start again on boot.

## A. Render

`render.yaml` uses the **free** plan in the **Singapore** region (closest to India). A free service sleeps
after 15 minutes without inbound traffic, so step 7 adds a monitor that keeps it awake.

1. <https://dashboard.render.com> → **New → Blueprint** → select the repo. Render reads `render.yaml`.
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

7. Keep the service awake (next section).

### Keep the free service awake

The monitor requests the site every 5 minutes. That is inbound traffic, so the 15-minute sleep timer never
fires. The same monitor also alerts you when the site is down.

1. Create a free account at <https://uptimerobot.com> (Better Stack and cron-job.org also work).
2. Add an **HTTP(s) – Keyword** monitor:
   - URL: `https://<service>.onrender.com/api/health` (use the `onrender.com` URL, so it works even if DNS breaks)
   - Keyword: `"ok":true`
   - Interval: **5 minutes**
3. Add your email (and the UptimeRobot mobile app for push alerts) as the alert contact.
4. Optional: publish the free status page and link it from the site footer.

Limits of this setup:

- **Instance hours:** Render gives 750 free hours per workspace per month. This service uses ~744 in a
  31-day month, so keep no other free web service awake in the same workspace.
- **Deploys and restarts:** the daily data redeploy and occasional platform restarts can cause a short gap
  (seconds to about a minute). This is not a cold start for visitors.
- **Not an SLA:** Render can change free-plan rules. For guaranteed no-sleep hosting, set `plan: starter` (paid).

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
| `ADVISOR_PER_IP_LIMIT` | `12` | Questions per IP per 10 minutes |
| `ADVISOR_FREE_DAILY` | `2` | Chats per day for a free account (or per IP when sign-in is off) |
| `ADVISOR_PAID_DAILY` | `15` | Chats per day for trial and paid accounts |
| `ADVISOR_FREE_POOL_DAILY` | `300` | All free-plan chats per Gemini day |
| `ADVISOR_DAILY_LIMIT` | `2000` | All chats per Gemini day; keep it under your Gemini quota |
| `TRIAL_SIGNUP_DEADLINE` | `2026-11-25T00:00:00+05:30` | Accounts created before this get the trial |
| `TRIAL_DAYS` | `30` | Trial length from sign-up |
| `SUBSCRIPTION_PRICE_INR` | `101` | Price shown in the UI; must match the Cashfree plan |
| `VITE_CLERK_PUBLISHABLE_KEY` | unset | Turns on sign-in (build time). Without Clerk, chat is limited per IP like a free account. |
| `CLERK_SECRET_KEY` | unset | Verifies sessions and stores paid-until dates on Clerk users |
| `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_PLAN_ID` | unset | Turn on subscriptions |
| `CASHFREE_ENV` | `sandbox` | `production` for real payments |
| `CASHFREE_WEBHOOK_SECRET` | client secret | Webhook signing key, if Cashfree gives a separate one |
| `PUBLIC_URL` | request origin | Site URL that Cashfree checkout returns to |
| `TRUST_PROXY` | unset | Set to `1` behind a proxy/load balancer, so per-IP limits and HSTS work. Not needed on Vercel. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | unset | Upstash Redis for rate limits shared across serverless instances (Vercel). `UPSTASH_REDIS_REST_URL`/`_TOKEN` also work. |
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
- **Roll back:** Vercel → Deployments → *Instant Rollback*; Render → Deploys → *Rollback*; Cloud Run → Revisions.
- **Privacy:** investor emails come from SEBI's public register; contact-person names and street addresses are not
  published. Advisor conversations are not stored by GrantKosh, but on the free tier Google may use them.
