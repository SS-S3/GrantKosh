# Deploying GrantKosh

GrantKosh ships as **one Node process** that serves the React UI, the data files and the Gemini-powered
Funding Advisor API. Production build: `npm run build:prod`. Start: `npm start`. Health check: `GET /api/health`. On Vercel the UI is served from the CDN and the API runs as serverless functions.

| Option | Cost | AI advisor | Effort |
|---|---|---|---|
| **Vercel (launch, up to ~200 users)** | Pro plan (~$20/month) once you charge subscriptions | Yes | ~15 min, no CLI |
| **Oracle Cloud Always Free VM (as you grow)** | Free (domain only) | Yes | ~45 min, SSH |
| A. Render free + keep-awake monitor | Free | Yes | ~15 min, no CLI |
| B. Docker (Google Cloud Run, Fly.io, Railway, any VPS) | Free tiers / cheap | Yes | ~15 min |

**Plan:** launch on Vercel, then move to Oracle once you pass roughly 200 users, or sooner if the Pro plan
costs more than subscriptions bring in. The same repo, environment variables, Clerk app, Cashfree plan and
Upstash database work on both, so moving is a DNS switch (see *Moving from Vercel to Oracle*).

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

Vercel serves the site and the data from its CDN, and runs the Advisor API as serverless functions
(`/api/health`, `/api/me`, `/api/chat`, `/api/billing/subscribe`, `/api/billing/webhook`). `vercel.json` runs `npm run build:vercel`, which builds the site and writes a
[Build Output](https://vercel.com/docs/build-output-api/v3) to `.vercel/output/` with
`scripts/vercel-output.mjs`. Static pages never sleep. A function that has been idle starts cold, which adds
a short delay to the first Advisor answer only.

**Plan:** Hobby (free) is for non-commercial use only. Selling Advisor subscriptions is commercial use, so
switch the project to **Pro** before you start charging (the free trial period can run on Hobby only if
nothing is sold yet).

### 1. Import the project

1. <https://vercel.com/new> → import the GitHub repo. Leave *Framework Preset* as **Other** and leave the
   build settings empty: `vercel.json` sets them.
2. Settings → Environment Variables → add `GEMINI_API_KEYS` (Production): one key, or up to four separated
   by commas (see *Gemini keys* below). Optional: `GEMINI_MODELS`, `GEMINI_MODELS_FREE` and the limits under
   *Rate limits and cost*. Do not set `TRUST_PROXY`: the functions detect Vercel.
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

| Plan | Who | Model | Chats (days reset at midnight IST) |
|---|---|---|---|
| Free | any signed-in account | Flash-Lite (`GEMINI_MODELS_FREE`) | `ADVISOR_FREE_DAILY` = 2 a day |
| Trial | claimed before `TRIAL_SIGNUP_DEADLINE` (25 Nov 2026, 00:00 IST) with a verified mobile number and a company CIN, LLPIN or PAN; one per company and per number; `TRIAL_DAYS` = 30 days from the claim | Flash (`GEMINI_MODELS`) | `ADVISOR_TRIAL_DAILY` = 5 a day, `ADVISOR_TRIAL_TOTAL` = 80 in all |
| Paid | active ₹129/month subscription | Flash (`GEMINI_MODELS`) | `ADVISOR_PAID_DAILY` = 15 a day, `ADVISOR_PAID_MONTHLY` = 120 per calendar month |

**Clerk (sign-in):**
1. Create an application at <https://dashboard.clerk.com>; enable Google and email code sign-in.
2. Vercel env vars: `VITE_CLERK_PUBLISHABLE_KEY` (used at build time, so redeploy after setting it) and
   `CLERK_SECRET_KEY`. Optional: `CLERK_AUTHORIZED_PARTIES=https://<your-domain>`, `CLERK_JWT_KEY` (PEM) for
   networkless token checks.
3. For production, create the Clerk production instance and add its DNS records (`clerk.<your-domain>`).
   The CSP picks up the Clerk origin from the publishable key automatically.
4. **Phone numbers** (needed to claim a trial): Configure → User & authentication → Phone number → turn on,
   with SMS verification. Check that Clerk delivers SMS to Indian numbers on your plan, and its SMS cost.
5. **Legal consent:** Configure → Legal → require agreeing to `https://<your-domain>/terms` and `/privacy` at
   sign-up. Keep **Delete account** enabled (the Privacy Policy says people can delete their account).

**Trial claims:** the Advisor asks a signed-in user without a trial for their company's CIN, LLPIN or PAN
(`agent/src/trial.ts`). Each company id and each phone number can start one trial. Only salted hashes are kept
(in Upstash, so they survive restarts and are shared across instances); the account stores a masked id. Set
`TRIAL_ID_SALT` to a random secret once and never change it, or earlier claims stop being recognised. This
checks format and uniqueness only: it does not prove the company exists.

**Cashfree (subscriptions):**
0. **Policy pages:** Cashfree checks the site for Terms, Privacy, Refund/Cancellation and Contact pages
   before activating payments. They are at `/terms`, `/privacy`, `/refunds` and `/contact`. Fill in the
   business details at the top of `web/src/LegalPages.tsx` first (blank fields show as "[to be added]"), and
   have the texts reviewed: they are drafts.
1. Cashfree dashboard → Subscriptions → create a **Periodic** plan: ₹129, every 1 month. Copy its plan id.
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

**Gemini keys.** `GEMINI_API_KEYS` takes up to four (or more) keys, separated by commas. Requests start on
each key in turn. A key that returns a quota error (429) rests for a minute, after a server error for 15
seconds, and if rejected for 10 minutes; the request moves to the next key first, then to the next model.
Keys from one Google Cloud project share one quota, so they only add failover. Keys from separate projects
each have their own quota and bill. Google's terms do not allow using extra projects to get around rate
limits, so for more capacity on one product, ask for a quota increase on the paid tier (AI Studio → Rate
limits) and use the extra keys for failover and to separate billing.

### Rate limits and cost

One Advisor answer makes 1–5 Gemini calls (tool use). Estimate ~15k input and ~1.5k output tokens, about
₹0.7 on Flash and roughly a quarter of that on Flash-Lite. Check current prices in AI Studio. Each answer's
real token use is logged (`[usage] plan=… model=… in=… out=…`) and added to daily totals in Redis
(`gk:tok:<day>:<model>:in|out`, kept 90 days), so you can price from measured numbers.

| Limit | Default | Why |
|---|---|---|
| `ADVISOR_FREE_DAILY` | 2 per account per day | Lets people try it on Flash-Lite; a few paise a day per free user |
| `ADVISOR_TRIAL_DAILY`, `ADVISOR_TRIAL_TOTAL` | 5 a day, 80 in all | Caps a trial at ~₹56 |
| `ADVISOR_PAID_DAILY`, `ADVISOR_PAID_MONTHLY` | 15 a day, 120 a month | Worst case ~₹84 a month. ₹129 nets ~₹105 after 18% GST and the gateway fee (~₹125 if you are not GST-registered). Typical use is far lower. |
| `ADVISOR_FREE_POOL_DAILY` | 300 per day, all free users together | Free users cannot use up the budget meant for paying users |
| `ADVISOR_DAILY_LIMIT` | 2000 per day, everyone | Hard ceiling under your Gemini quota and budget. Counted per Gemini day (midnight Pacific), when Google resets quotas |
| `ADVISOR_GLOBAL_RPM` | 60 per minute, everyone | Counted in 10-second windows. When a window is full, a chat waits for the next one (the person sees "you're next in line"), for up to `ADVISOR_QUEUE_WAIT_MS` = 20 s, then gets "busy, try again in a minute". Set it under your Gemini requests-per-minute quota divided by ~3 (calls per answer). |
| `ADVISOR_PER_IP_LIMIT` | 12 chats per IP per 10 min | Stops scripts before any account lookup |
| `ADVISOR_IP_API_PER_MIN` | 90 API calls per IP per minute | Every API route except health and the signed Cashfree webhook |
| `ADVISOR_IP_DIRECTORY_PER_DAY` | 1,500 directory requests per IP per day | Slows anyone copying the directory page by page |
| One answer at a time per account | fixed | A second chat while one is running gets "still being answered" |
| `ADVISOR_CACHE_TTL_S` | 6 hours | An opening question identical to an earlier one (ignoring case and spacing) replays the stored answer: no model call, and no wait when busy. It still counts against the person's own limits. Cleared daily with the data. `0` turns it off. |

Set a budget alert on the Google Cloud project as well. The limits need Upstash Redis on Vercel (step 2).

### Bots, abuse and DDoS

What the code does:
- Per-IP limits on every API route, per-account limits, one answer at a time per account, and a global
  rate and daily ceiling (above), so no single source can run up the Gemini bill.
- Chat and subscribe accept only JSON POSTs from the site's own origin (`ALLOWED_ORIGINS` adds others).
  Clerk session tokens are accepted only for `PUBLIC_URL` (or `CLERK_AUTHORIZED_PARTIES`).
- Body size caps, schema-checked input, and only the last 8 turns of a chat go to the model.
- Cashfree webhooks must be signed, and each delivery is applied once, so a captured webhook cannot be
  replayed to extend access.
- The Node server cuts off slow or half-sent requests (header and request timeouts).
- Strict CSP and security headers on every response.

What the code cannot do: stop a flood of traffic before it reaches the app. That needs the platform's edge:
1. **Vercel → Firewall:** turn on **Bot Protection** (challenge non-browser traffic) and keep the default
   DDoS mitigation. During an attack, turn on **Attack Challenge Mode**. Add a rate-limit rule, e.g. 20
   requests per minute per IP on `/api/chat`, so floods are dropped before a function runs and before you
   pay for it.
2. **Clerk → Configure → Attack protection:** turn on **Bot sign-up protection** (CAPTCHA), and in
   Restrictions **block disposable email addresses**. This limits fake accounts collecting extra trials.
   Requiring a verified phone number at sign-up stops it further, at some cost to sign-ups.
3. **Upstash:** set a monthly budget cap, since every chat uses a few Redis commands.
4. **Google Cloud:** a budget alert, and API key restrictions (Generative Language API only).

### 4. Domain and daily data

1. Settings → Domains → add your domain and its `www.` form, then create the DNS records Vercel shows.
   Vercel issues the HTTPS certificate.
2. Change `og:image` in `web/index.html` to `https://<your-domain>/brand/og-image.jpg` and push.
3. Vercel deploys every push to `main`, including the bot's daily data commit, so new data goes live after
   each scrape. No workflow change is needed.
4. Add an UptimeRobot keyword monitor on `/api/health` (see "Keep the free service awake" below; on Vercel
   it is only for down alerts, so a 15-minute interval is enough).

To check the build output locally: `npm run build:vercel`, then look in `.vercel/output/`.

## Moving from Vercel to Oracle

Do this when you pass roughly 200 users, or when Vercel Pro costs more than it saves you in effort. Users
notice nothing: same domain, same accounts, same subscriptions, same usage counts.

1. **Build the image with sign-in.** GitHub → Settings → Secrets and variables → Actions → **Variables** →
   add `VITE_CLERK_PUBLISHABLE_KEY` (the same value as on Vercel). Then run the *Container image* workflow.
   Without it the image has no sign-in button.
2. **Set up the VM** with the Oracle steps below, but don't change DNS yet.
3. **Copy the environment variables** from Vercel (Settings → Environment Variables, or `vercel env pull`)
   into `deploy/oracle/.env`. Keep `UPSTASH_REDIS_REST_URL`/`_TOKEN` (or set them from `KV_REST_API_URL`/`_TOKEN`):
   the trial totals, monthly usage and webhook history live there, so keeping the same database carries
   them over. Set `CLERK_PUBLISHABLE_KEY` too, so the server's CSP allows Clerk.
4. **Test before switching.** Add the VM's IP to your own computer's hosts file for the domain, open the
   site, sign in, and ask the Advisor a question. Check `/api/health` shows `"auth":true,"billing":true`.
5. **Switch DNS:** point the domain's A record (and `www`) at the VM and remove the Vercel records. Use a
   short TTL (300 s) a day before, so the switch takes minutes. Caddy gets the TLS certificate on first visit.
6. **Nothing changes in Clerk or Cashfree**, because the domain is the same: the webhook URL and
   `PUBLIC_URL` stay valid.
7. Keep the Vercel project for a week as a fallback (switching DNS back is the rollback), then delete it
   or downgrade to Hobby.

The daily data job keeps working: `scrape.yml` commits new data, and `image.yml` rebuilds the image, which the
VM pulls (see *Operating the VM*).

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

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEYS` | (none) | Comma-separated Gemini keys; enables the AI advisor. `GEMINI_API_KEY` (one key) also works. Without a key the advisor runs in guided mode. |
| `GEMINI_MODELS` | `gemini-3.8-flash,gemini-2.5-flash,gemini-3.5-flash-lite` | Trial and paid plans. Tried in order; falls back when one is rate-limited |
| `GEMINI_MODELS_FREE` | `gemini-3.5-flash-lite,gemini-2.5-flash-lite` | Free plan |
| `ADVISOR_PER_IP_LIMIT` | `12` | Chats per IP per 10 minutes |
| `ADVISOR_IP_API_PER_MIN` | `90` | API calls per IP per minute |
| `ADVISOR_IP_DIRECTORY_PER_DAY` | `1500` | Directory requests (search pages, details, guided matches) per IP per day |
| `ADVISOR_FREE_DAILY` | `2` | Chats per day for a free account (or per IP when sign-in is off) |
| `ADVISOR_TRIAL_DAILY`, `ADVISOR_TRIAL_TOTAL` | `5`, `80` | Trial chats per day and in all |
| `ADVISOR_PAID_DAILY`, `ADVISOR_PAID_MONTHLY` | `15`, `120` | Paid chats per day and per calendar month |
| `ADVISOR_FREE_POOL_DAILY` | `300` | All free-plan chats per Gemini day |
| `ADVISOR_DAILY_LIMIT` | `2000` | All chats per Gemini day; keep it under your Gemini quota |
| `ADVISOR_GLOBAL_RPM` | `60` | All model-backed chats per minute; extra chats wait up to `ADVISOR_QUEUE_WAIT_MS` (`20000`) |
| `ADVISOR_CACHE_TTL_S` | `21600` | How long a repeated opening question's answer is reused; `0` = off |
| `ALLOWED_ORIGINS` | unset | Extra browser origins allowed to call the API (comma-separated) |
| `TRIAL_SIGNUP_DEADLINE` | `2026-11-25T00:00:00+05:30` | Accounts created before this get the trial |
| `TRIAL_DAYS` | `30` | Trial length from sign-up |
| `TRIAL_ID_SALT` | built-in default | Secret for hashing trial company ids and phone numbers. Set once; never change. |
| `SUBSCRIPTION_PRICE_INR` | `129` | Price shown in the UI; must match the Cashfree plan |
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

## Keeping the data private

The browser never downloads the data files. Search, filters, programme details and guided matching all go
through the API (`agent/src/directory.ts`), which returns at most 50 records per request:
- `/data/*.json` is not served (404). The build moves the files to `web/dist-data/`, outside the site.
- Records get opaque ids (`?open=-PZ8CCMqSDFi`), and the API leaves out source fields.
- The site doesn't name its sources, link to data files or offer CSV export.
- Each IP may make `ADVISOR_IP_API_PER_MIN` (90) API calls a minute and `ADVISOR_IP_DIRECTORY_PER_DAY`
  (1,500) directory requests a day. Directory responses are cached only in the visitor's own browser, so a
  CDN never answers past those limits.

This makes bulk copying slow, not impossible: someone using many IP addresses can still page through
everything. Vercel's Firewall rate-limit rules (see *Bots, abuse and DDoS*) and Bot Protection add an edge
layer.

**The GitHub repository:** if it is public, the data and its daily history are public there. Make it private
(Settings → General → Danger zone → Change visibility). Vercel, the Actions workflows and GHCR keep working;
a private GHCR image needs `docker login ghcr.io` on the Oracle VM with a read-only token. Copies made while
it was public, under the earlier CC BY 4.0 notice, can't be recalled.

## What's already production-ready

- **Server:** a single bundled file (`agent/dist/server.mjs`, no `node_modules` needed at runtime), listening on `0.0.0.0`, with graceful shutdown on SIGTERM.
- **Static files:** precompressed with brotli and gzip (data JSON 7.5 MB → ~0.6 MB). Cache policy: hashed assets cached for a year, data for an hour, `index.html` revalidated. Supports `Last-Modified`/304 and HEAD.
- **Security headers:** strict CSP (self + Google Fonts only), `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, and HSTS behind HTTPS proxies.
- **Request handling:** path-traversal protection, body size limits, schema-validated chat input, same-origin JSON POSTs, request timeouts, and the limits under *Rate limits and cost*.
- **AI resilience:** several keys with failover, then model fallback on quota or overload; a queue when busy; cached answers for repeated questions. If every key is rejected or Gemini is down, the UI switches to guided mode.
- **CI** (`.github/workflows/validate.yml`): validate, typecheck, run the 74 tests, production build, a server smoke test, and a Docker build-and-probe.
- **Daily data refresh** (`.github/workflows/scrape.yml`): 06:00 IST scrape, commit, redeploy.

## After launch

- **Monitor quota and cost:** AI Studio → Rate limits, and the `[usage]` log lines or `gk:tok:*` totals.
  If people often see "busy", raise the Gemini quota and `ADVISOR_GLOBAL_RPM` together.
- **Watch the data job:** `web/public/data/meta.json` lists each source's status (no longer shown on the site). A stale source keeps its last good data,
  and the workflow log shows why it failed.
- **Roll back:** Vercel → Deployments → *Instant Rollback*; Render → Deploys → *Rollback*; Cloud Run → Revisions.
- **Privacy:** investor emails come from SEBI's public register; contact-person names and street addresses are not
  published. Advisor conversations are not stored by GrantKosh, except that the answer to an opening question is kept for up to
6 hours (under a hash of the question) to answer the same question again. On the free tier Google may use them.
