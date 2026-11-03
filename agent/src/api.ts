// GrantKosh Advisor API, shared by the long-running server (server.ts) and the Vercel functions (vercel.ts).
//   GET  /api/health             → { ai, models, dataGeneratedAt, auth, billing }
//   GET  /api/me                 → the caller's plan and today's usage
//   POST /api/chat               → text/event-stream of AgentEvent JSON lines (signed-in users when auth is on)
//   POST /api/billing/subscribe  → { sessionId, mode } to open Cashfree subscription checkout
//   POST /api/billing/webhook    → Cashfree subscription events
// Configure with agent/.env (see .env.example). Without GEMINI_API_KEY the UI uses guided mode.
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { type AgentEvent, errorEvent, runAdvisor } from "./agent";
import { type AccountInfo, authEnabled, getAccount, saveBilling, userIdFrom } from "./auth";
import { billingEnabled, billingUpdate, CASHFREE_MODE, createSubscription, firstChargeAt, verifyWebhook, type WebhookEvent } from "./billing";
import { getDataset } from "./data";
import { burstOk, takeChat, usedToday } from "./limits";
import { DAILY_LIMITS, entitlement, PRICE_INR, TRIAL_DAYS, TRIAL_SIGNUP_DEADLINE } from "./plans";
import { mockAi } from "./mock";
import HEADERS from "./security-headers.json";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
export const MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-2.5-flash").split(",").map(s => s.trim()).filter(Boolean);
/** Vercel always sits behind its own proxy, which sets X-Forwarded-For and X-Forwarded-Proto. */
const TRUST_PROXY = !!(process.env.TRUST_PROXY || process.env.VERCEL);

export const MOCK = process.env.ADVISOR_MOCK === "1";
export const ai = MOCK ? mockAi() : API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

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
export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readRaw(req: IncomingMessage, max = 64 * 1024): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
const readBody = async (req: IncomingMessage) => (await readRaw(req)).toString("utf8");

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
  const offer = { trialDays: TRIAL_DAYS, trialSignupDeadline: new Date(TRIAL_SIGNUP_DEADLINE).toISOString(), priceInr: PRICE_INR };
  const c = await caller(req);
  if (!c) return json(res, 200, { signedIn: false, ...offer });
  const e = entitlement(c.account);
  json(res, 200, {
    signedIn: !!c.account,
    ...offer,
    plan: e.plan,
    dailyLimit: e.dailyLimit,
    usedToday: await usedToday(c.who),
    trialEndsAt: e.trialEndsAt && new Date(e.trialEndsAt).toISOString(),
    paidUntil: e.paidUntil && new Date(e.paidUntil).toISOString(),
    canSubscribe: billingEnabled && !!c.account,
  });
}

const LIMIT_MESSAGES = {
  burst: "You've asked a lot of questions in a short time. Please wait a few minutes, or use guided matching.",
  pool: "Free advisor chats are used up for today. Guided matching still works, or subscribe for more chats.",
  global: "The advisor has reached today's capacity. Guided matching still works.",
} as const;

// ---------- chat ----------
async function chat(req: IncomingMessage, res: ServerResponse) {
  if (!ai) return json(res, 503, { error: "AI advisor not configured (GEMINI_API_KEY missing)", code: "unavailable" });
  if (!(await burstOk(clientIp(req)))) return json(res, 429, { code: "quota", error: LIMIT_MESSAGES.burst });
  const c = await caller(req);
  if (!c) return json(res, 401, SIGN_IN);

  let body: z.infer<typeof ChatBody>;
  try {
    body = ChatBody.parse(JSON.parse(await readBody(req)));
  } catch (err) {
    return json(res, 400, { error: err instanceof z.ZodError ? err.issues[0]?.message : "invalid JSON body" });
  }

  const e = entitlement(c.account);
  const verdict = await takeChat(c.who, e.plan, e.dailyLimit);
  if (verdict === "user") {
    const error = e.plan === "free" ? `You've used your ${e.dailyLimit} free chats for today. Subscribe for ₹${PRICE_INR}/month to get ${DAILY_LIMITS.paid} a day, or come back tomorrow.` : `You've used today's ${e.dailyLimit} chats. They reset at midnight IST.`;
    return json(res, 429, { code: e.plan === "free" ? "upgrade" : "quota", error });
  }
  if (verdict !== "ok") return json(res, 429, { code: verdict === "pool" ? "upgrade" : "quota", error: LIMIT_MESSAGES[verdict] });

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (e: AgentEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    await runAdvisor(body.messages, send, { ai, models: MODELS, dataset: getDataset(), signal: abort.signal });
  } catch (err) {
    if (!abort.signal.aborted) {
      const event = errorEvent(err);
      console.error("[advisor]", event.type === "error" && event.code === "unavailable" ? "Gemini unavailable or GEMINI_API_KEY rejected:" : "", (err as Error).message.slice(0, 300));
      send(event);
    }
  } finally {
    res.end();
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
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as WebhookEvent;
  } catch {
    return json(res, 400, { error: "invalid JSON body" });
  }
  const userId = billingUpdate(event)?.userId;
  if (userId) {
    const { userId: _, ...update } = billingUpdate(event, (await getAccount(userId)).paidUntil ?? 0)!;
    await saveBilling(userId, update);
    console.log(`[billing] ${event.type} ${update.subscriptionId}${update.paidUntil ? ` paid until ${new Date(update.paidUntil).toISOString()}` : ""}`);
  }
  json(res, 200, { ok: true });
}

/** Handles every /api/* request. Security headers are the caller's job. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/api/health" && (req.method === "GET" || req.method === "HEAD")) {
      return json(res, 200, { ok: true, ai: !!ai, models: ai ? MODELS : [], dataGeneratedAt: getDataset().generatedAt, auth: authEnabled, billing: billingEnabled });
    }
    if (path === "/api/me" && req.method === "GET") return await me(req, res);
    if (path === "/api/billing/subscribe" && req.method === "POST") return await subscribe(req, res);
    if (path === "/api/billing/webhook" && req.method === "POST") return await webhook(req, res);
    if (path === "/api/chat") {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });
      return await chat(req, res);
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
    else res.end();
  }
}
