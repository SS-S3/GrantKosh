// GrantKosh Advisor API, shared by the long-running server (server.ts) and the Vercel functions (vercel.ts).
//   GET  /api/health             → { ai, models, dataGeneratedAt, auth, billing }
//   GET  /api/me                 → the caller's plan and usage
//   POST /api/chat               → text/event-stream of AgentEvent JSON lines (signed-in users when auth is on)
//   POST /api/billing/subscribe  → { sessionId, mode } to open Cashfree subscription checkout
//   POST /api/billing/webhook    → Cashfree subscription events
// Configure with agent/.env (see .env.example). Without a Gemini key the UI uses guided mode.
// Abuse protection: per-IP limits on every route, JSON-only POSTs from this site's origin, size caps
// on bodies and chat history, one answer at a time per account, and the limits in limits.ts.
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { type AgentEvent, type ChatTurn, errorEvent, runAdvisor } from "./agent";
import { type AccountInfo, authEnabled, getAccount, saveBilling, userIdFrom } from "./auth";
import { billingEnabled, billingUpdate, CASHFREE_MODE, createSubscription, firstChargeAt, verifyWebhook, type WebhookEvent } from "./billing";
import { cacheKey, getCached, putCached } from "./cache";
import { getDataset } from "./data";
import { apiKeys, KeyPool } from "./gemini";
import { apiRateOk, burstOk, lockUser, recordTokens, takeChat, usage, type Verdict, withStore } from "./limits";
import { DAILY_LIMITS, type Entitlement, entitlement, PAID_MONTHLY, PRICE_INR, TRIAL_DAYS, TRIAL_SIGNUP_DEADLINE } from "./plans";
import { mockAi } from "./mock";
import HEADERS from "./security-headers.json";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const modelList = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);
/** Trial and paid plans: Flash first; Flash-Lite only as a last resort when Flash is unavailable. */
export const MODELS = modelList(process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-2.5-flash,gemini-3.5-flash-lite");
/** Free plan: the cheaper Flash-Lite models. */
export const FREE_MODELS = modelList(process.env.GEMINI_MODELS_FREE ?? "gemini-3.5-flash-lite,gemini-2.5-flash-lite");
/** Vercel always sits behind its own proxy, which sets X-Forwarded-For and X-Forwarded-Proto. */
const TRUST_PROXY = !!(process.env.TRUST_PROXY || process.env.VERCEL);

export const MOCK = process.env.ADVISOR_MOCK === "1";
const KEYS = apiKeys();
export const keys = MOCK ? new KeyPool([{ id: 1, ai: mockAi() }]) : KEYS.length ? new KeyPool(KEYS.map((apiKey, i) => ({ id: i + 1, ai: new GoogleGenAI({ apiKey }) }))) : null;
/** Browser origins allowed to call the API besides this site's own, e.g. https://www.grantkosh.in. */
const ALLOWED_ORIGINS = new Set(modelList(process.env.ALLOWED_ORIGINS ?? ""));

/** Only the latest turns go to the model: older ones add cost without changing the answer much. */
const MAX_HISTORY = 8;
const MAX_ASSISTANT_CHARS = 2500;

const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) }))
    .min(1)
    .max(24)
    .refine(m => m[m.length - 1]!.role === "user", "last message must be from the user")
    .refine(m => m[m.length - 1]!.content.length <= 2000, "message too long (max 2000 characters)"),
});

const clientIp = (req: IncomingMessage) =>
  (TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() : "") || req.socket.remoteAddress || "unknown";

// ---------- helpers ----------
export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

const isJson = (req: IncomingMessage) => /^application\/json\b/i.test(String(req.headers["content-type"] ?? ""));

/**
 * Browsers send Origin on POSTs. A request from another site's page is refused, so other sites can't
 * use a visitor's session. Clients that send no Origin still need a valid session.
 */
function originOk(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const host = new URL(origin).host;
    const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-host"] ?? "").split(",")[0]!.trim() : "";
    return host === req.headers.host || host === forwarded || (!!process.env.PUBLIC_URL && host === new URL(process.env.PUBLIC_URL).host);
  } catch {
    return false;
  }
}

async function readRaw(req: IncomingMessage, max = 48 * 1024): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
const readBody = async (req: IncomingMessage, max?: number) => (await readRaw(req, max)).toString("utf8");

// Baseline security headers for every response. The CSP allows this origin, Google Fonts, Clerk sign-in
// and Cashfree checkout. The JSON file is shared with scripts/vercel-output.mjs, which builds the same
// headers for static files on Vercel.
/** Clerk's Frontend API origin is encoded in the publishable key: pk_live_<base64("clerk.example.com$")>. */
export function clerkOrigin(publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY ?? ""): string | null {
  const host = Buffer.from(publishableKey.split("_")[2] ?? "", "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
}

export const SECURITY_HEADERS: Record<string, string> = (() => {
  const clerk = clerkOrigin();
  const csp = Object.entries(HEADERS.csp)
    .map(([k, v]) => [k, ...v, ...(clerk && (k === "script-src" || k === "connect-src") ? [clerk] : [])].join(" "))
    .join("; ");
  return { "Content-Security-Policy": csp, ...HEADERS.headers };
})();

export function setSecurityHeaders(req: IncomingMessage, res: ServerResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

// ---------- caller ----------
interface Caller {
  /** Rate-limit identity: the account id, or `ip:<addr>` when sign-in is off. */
  who: string;
  account: AccountInfo | null;
}

/** null = sign-in is on and the request has no valid session. */
async function caller(req: IncomingMessage): Promise<Caller | null> {
  if (!authEnabled) return { who: `ip:${clientIp(req)}`, account: null };
  const id = await userIdFrom(req);
  return id ? { who: id, account: await getAccount(id) } : null;
}

const SIGN_IN = { code: "auth", error: "Sign in to use the advisor." };

async function me(req: IncomingMessage, res: ServerResponse) {
  const offer = { trialDays: TRIAL_DAYS, trialSignupDeadline: new Date(TRIAL_SIGNUP_DEADLINE).toISOString(), priceInr: PRICE_INR, freeDaily: DAILY_LIMITS.free, paidDaily: DAILY_LIMITS.paid, paidMonthly: PAID_MONTHLY };
  const c = await caller(req);
  if (!c) return json(res, 200, { signedIn: false, ...offer });
  const e = entitlement(c.account);
  const used = await usage(c.who, e);
  json(res, 200, {
    signedIn: !!c.account,
    ...offer,
    plan: e.plan,
    dailyLimit: e.dailyLimit,
    usedToday: used.today,
    period: e.period && { kind: e.period.kind, limit: e.period.limit, used: used.period },
    trialEndsAt: e.trialEndsAt && new Date(e.trialEndsAt).toISOString(),
    paidUntil: e.paidUntil && new Date(e.paidUntil).toISOString(),
    canSubscribe: billingEnabled && !!c.account,
  });
}

const BURST = { code: "quota", error: "You've asked a lot of questions in a short time. Please wait a few minutes, or use guided matching." };
const TOO_MANY = { code: "quota", error: "Too many requests. Please slow down." };

/** Why a chat was refused, as [HTTP status, body]. */
function refusal(verdict: Exclude<Verdict, "ok">, e: Entitlement): [number, { code: string; error: string }] {
  const subscribe = `Subscribe for ₹${PRICE_INR}/month for up to ${DAILY_LIMITS.paid} chats a day`;
  switch (verdict) {
    case "user":
      return e.plan === "free"
        ? [429, { code: "upgrade", error: `You've used your ${e.dailyLimit} free chats for today. ${subscribe}, or come back tomorrow.` }]
        : [429, { code: "quota", error: `You've used today's ${e.dailyLimit} chats. They reset at midnight IST.` }];
    case "period":
      return e.period?.kind === "trial"
        ? [429, { code: "upgrade", error: `You've used all ${e.period.limit} chats in your free trial. ${subscribe}.` }]
        : [429, { code: "quota", error: `You've used this month's ${e.period?.limit} chats. They reset on the 1st.` }];
    case "pool":
      return [429, { code: "upgrade", error: `Free advisor chats are used up for today. Guided matching still works, or ${subscribe.charAt(0).toLowerCase()}${subscribe.slice(1)}.` }];
    case "global":
      return [429, { code: "quota", error: "The advisor has reached today's capacity. Guided matching still works." }];
    case "busy":
      return [503, { code: "busy", error: "The advisor is very busy right now. Please try again in a minute." }];
  }
}

function trimHistory(messages: ChatTurn[]): ChatTurn[] {
  let turns = messages.slice(-MAX_HISTORY);
  while (turns[0]?.role === "assistant") turns = turns.slice(1);
  return turns.map(t => (t.role === "assistant" && t.content.length > MAX_ASSISTANT_CHARS ? { ...t, content: `${t.content.slice(0, MAX_ASSISTANT_CHARS)}…` } : t));
}

// ---------- chat ----------
async function chat(req: IncomingMessage, res: ServerResponse) {
  if (!keys) return json(res, 503, { error: "AI advisor not configured (GEMINI_API_KEYS missing)", code: "unavailable" });
  if (!(await burstOk(clientIp(req)))) return json(res, 429, BURST, { "Retry-After": "600" });
  const c = await caller(req);
  if (!c) return json(res, 401, SIGN_IN);

  let body: z.infer<typeof ChatBody>;
  try {
    body = ChatBody.parse(JSON.parse(await readBody(req, 128 * 1024)));
  } catch (err) {
    return json(res, 400, { error: err instanceof z.ZodError ? err.issues[0]?.message : "invalid JSON body" });
  }

  const e = entitlement(c.account);
  const tier = e.plan === "free" ? "free" : "flash";
  const dataset = getDataset();
  const key = cacheKey(body.messages, tier, dataset.generatedAt);
  const cached = key ? await getCached(key) : null;

  const release = await lockUser(c.who);
  if (!release) return json(res, 429, { code: "busy", error: "Your previous question is still being answered. Please wait for it to finish." });

  const send = (ev: AgentEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  const open = () => {
    if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  };
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    const verdict = await takeChat(c.who, e, {
      model: !cached,
      // Open the stream while the chat waits, so the person sees why it's slow.
      onWait: () => {
        open();
        send({ type: "status", text: "Lots of people are asking right now. You're next in line…" });
      },
    });
    if (verdict !== "ok") {
      const [status, refused] = refusal(verdict, e);
      if (!res.headersSent) return json(res, status, refused, verdict === "busy" ? { "Retry-After": "60" } : {});
      return send({ type: "error", code: refused.code as "quota", message: refused.error });
    }
    open();
    if (cached) {
      for (const ev of cached) send(ev);
      return;
    }
    const events: AgentEvent[] = [];
    const result = await runAdvisor(trimHistory(body.messages), ev => (events.push(ev), send(ev)), { keys, models: tier === "free" ? FREE_MODELS : MODELS, dataset, signal: abort.signal });
    console.log(`[usage] plan=${e.plan} model=${result.model} in=${result.inputTokens} out=${result.outputTokens}`);
    void recordTokens(result.model, result.inputTokens, result.outputTokens);
    if (key) await putCached(key, events);
  } catch (err) {
    if (!abort.signal.aborted) {
      const event = errorEvent(err);
      console.error("[advisor]", event.type === "error" && event.code === "unavailable" ? "Gemini unavailable or every key rejected:" : "", (err as Error).message.slice(0, 300));
      open();
      send(event);
    }
  } finally {
    await release();
    if (!res.writableEnded) res.end();
  }
}

// ---------- billing ----------
const SubscribeBody = z.object({ phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number") });

/** Where Cashfree sends the browser back to: PUBLIC_URL, else this request's own origin. */
function siteUrl(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = TRUST_PROXY ? String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0] : "http";
  return `${proto}://${req.headers.host}`;
}

async function subscribe(req: IncomingMessage, res: ServerResponse) {
  if (!billingEnabled || !authEnabled) return json(res, 503, { error: "Subscriptions aren't set up on this deployment." });
  const c = await caller(req);
  if (!c?.account) return json(res, 401, SIGN_IN);
  let body: z.infer<typeof SubscribeBody>;
  try {
    body = SubscribeBody.parse(JSON.parse(await readBody(req)));
  } catch (err) {
    return json(res, 400, { error: err instanceof z.ZodError ? err.issues[0]?.message : "invalid JSON body" });
  }
  if (!c.account.email) return json(res, 400, { error: "Add an email address to your account first." });
  const e = entitlement(c.account);
  const accessEndsAt = Math.max(e.trialEndsAt ?? 0, e.paidUntil ?? 0) || null;
  try {
    const { sessionId, subscriptionId } = await createSubscription({
      userId: c.account.id,
      email: c.account.email,
      phone: body.phone,
      name: c.account.name,
      firstChargeAt: firstChargeAt(accessEndsAt && accessEndsAt > Date.now() ? accessEndsAt : null),
      returnUrl: `${siteUrl(req)}/?tab=advisor&billing=return`,
    });
    await saveBilling(c.account.id, { subscriptionId, subscriptionStatus: "INITIALIZED" });
    json(res, 200, { sessionId, mode: CASHFREE_MODE });
  } catch (err) {
    console.error("[billing]", (err as Error).message.slice(0, 300));
    json(res, 502, { error: "Couldn't start the payment. Please try again in a minute." });
  }
}

async function webhook(req: IncomingMessage, res: ServerResponse) {
  const raw = await readRaw(req, 256 * 1024);
  const header = (name: string) => (req.headers[name] as string | undefined) ?? undefined;
  if (!verifyWebhook(raw, header("x-webhook-timestamp"), header("x-webhook-signature"))) return json(res, 401, { error: "bad signature" });
  // Each signed delivery is applied once, so a captured webhook can't be replayed to extend access.
  const seenKey = `gk:wh:${createHash("sha256").update(raw).digest("base64url")}`;
  if (!(await withStore(s => s.lock(seenKey, 60 * 24 * 3600)))) return json(res, 200, { ok: true, duplicate: true });
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as WebhookEvent;
  } catch {
    return json(res, 400, { error: "invalid JSON body" });
  }
  const userId = billingUpdate(event)?.userId;
  if (userId) {
    try {
      const { userId: _, ...update } = billingUpdate(event, (await getAccount(userId)).paidUntil ?? 0)!;
      await saveBilling(userId, update);
      console.log(`[billing] ${event.type} ${update.subscriptionId}${update.paidUntil ? ` paid until ${new Date(update.paidUntil).toISOString()}` : ""}`);
    } catch (err) {
      // Not applied: forget the delivery so Cashfree's retry is processed.
      await withStore(s => s.del(seenKey)).catch(() => {});
      throw err;
    }
  }
  json(res, 200, { ok: true });
}

/** Handles every /api/* request. Security headers are the caller's job. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/api/health" && (req.method === "GET" || req.method === "HEAD")) {
      return json(res, 200, { ok: true, ai: !!keys, models: keys ? MODELS : [], dataGeneratedAt: getDataset().generatedAt, auth: authEnabled, billing: billingEnabled });
    }
    // Cashfree's webhook is signed; every other route counts against the caller's IP.
    if (path === "/api/billing/webhook" && req.method === "POST") return await webhook(req, res);
    if (!(await apiRateOk(clientIp(req)))) return json(res, 429, TOO_MANY, { "Retry-After": "60" });
    if (path === "/api/me" && req.method === "GET") return await me(req, res);
    const post = path === "/api/chat" || path === "/api/billing/subscribe";
    if (post && req.method !== "POST") return json(res, 405, { error: "POST only" });
    if (post && !originOk(req)) return json(res, 403, { error: "cross-site request refused" });
    if (post && !isJson(req)) return json(res, 415, { error: "send application/json" });
    if (path === "/api/billing/subscribe") return await subscribe(req, res);
    if (path === "/api/chat") return await chat(req, res);
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
    else res.end();
  }
}
