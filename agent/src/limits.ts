// Advisor rate limits and load control:
//   ip       per IP: ADVISOR_PER_IP_LIMIT chats per 10 minutes, and ADVISOR_IP_API_PER_MIN API calls per
//            minute on every route, so scripts are stopped before any account lookup or model call
//   user     per account per IST day, by plan (plans.ts), plus the trial total or the paid monthly cap
//   lock     one answer at a time per account, so a script can't fan out parallel chats
//   pool     all free-plan chats per Gemini day, ADVISOR_FREE_POOL_DAILY, so free users cannot use up
//            the budget that trial and paid users rely on
//   global   all chats per Gemini day, ADVISOR_DAILY_LIMIT, a hard ceiling under the Gemini quota/budget
//   rate     all model-backed chats per 10 seconds (ADVISOR_GLOBAL_RPM / 6). When a window is full the
//            chat waits for the next one, up to ADVISOR_QUEUE_WAIT_MS, instead of hitting Gemini's
//            per-minute quota; past that it is turned away with "busy".
// A long-running server keeps the counters in memory. Serverless platforms (Vercel) run many short-lived
// instances that share no memory, so when Upstash Redis credentials are set the counters live there.
// If Redis is unreachable, the in-memory counters are used so the advisor keeps working.
import { type Entitlement, geminiDay, istDay } from "./plans";

export type Verdict = "ok" | "user" | "period" | "pool" | "global" | "busy";

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const PER_IP_LIMIT = env("ADVISOR_PER_IP_LIMIT", 12);
const PER_IP_WINDOW_S = 10 * 60;
const IP_API_PER_MIN = env("ADVISOR_IP_API_PER_MIN", 60);
const FREE_POOL_DAILY = env("ADVISOR_FREE_POOL_DAILY", 300);
const GLOBAL_DAILY = env("ADVISOR_DAILY_LIMIT", 2000);
const RATE_WINDOW_S = 10;
const PER_RATE_WINDOW = Math.max(1, Math.floor(env("ADVISOR_GLOBAL_RPM", 60) / 6));
const QUEUE_WAIT_MS = env("ADVISOR_QUEUE_WAIT_MS", 20_000);
const LOCK_TTL_S = 90;
const DAY_TTL_S = 2 * 24 * 3600;
const PERIOD_TTL_S = 40 * 24 * 3600;

// Vercel's Upstash integration sets KV_REST_API_*; a direct Upstash database gives UPSTASH_REDIS_REST_*.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
export const sharedLimits = !!(REDIS_URL && REDIS_TOKEN);

export interface Store {
  get(keys: string[]): Promise<number[]>;
  incr(keys: string[], ttlSeconds: number, by?: number): Promise<number[]>;
  /** Sets the key only if it doesn't exist; true when this call set it. */
  lock(key: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  getText(key: string): Promise<string | null>;
  setText(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// ---------- in memory ----------
const entries = new Map<string, { v: number | string; expires: number }>();
const live = (key: string) => {
  const e = entries.get(key);
  if (e && e.expires <= Date.now()) entries.delete(key);
  return entries.get(key);
};
const sweep = () => {
  if (entries.size > 50_000) for (const k of entries.keys()) live(k);
  // Still too big: drop the oldest entries (Map keeps insertion order).
  for (const k of entries.keys()) {
    if (entries.size <= 50_000) break;
    entries.delete(k);
  }
};
const memory: Store = {
  async get(keys) {
    return keys.map(k => Number(live(k)?.v ?? 0));
  },
  async incr(keys, ttl, by = 1) {
    sweep();
    return keys.map(k => {
      const e = live(k) ?? { v: 0, expires: Date.now() + ttl * 1000 };
      e.v = Number(e.v) + by;
      entries.set(k, e);
      return e.v;
    });
  },
  async lock(key, ttl) {
    if (live(key)) return false;
    sweep();
    entries.set(key, { v: 1, expires: Date.now() + ttl * 1000 });
    return true;
  },
  async del(key) {
    entries.delete(key);
  },
  async getText(key) {
    const v = live(key)?.v;
    return typeof v === "string" ? v : null;
  },
  async setText(key, value, ttl) {
    sweep();
    entries.set(key, { v: value, expires: Date.now() + ttl * 1000 });
  },
};

// ---------- Upstash Redis (REST) ----------
async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${REDIS_URL.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = out.find(r => r.error);
  if (failed) throw new Error(`Upstash: ${failed.error}`);
  return out.map(r => r.result);
}
const redis: Store = {
  async get(keys) {
    const [values] = (await pipeline([["MGET", ...keys]])) as [(string | null)[]];
    return values.map(v => Number(v ?? 0));
  },
  async incr(keys, ttl, by = 1) {
    // Every key carries its day or window, so refreshing the TTL on each INCR is harmless.
    const out = await pipeline(keys.flatMap(k => [["INCRBY", k, by], ["EXPIRE", k, ttl]]));
    return keys.map((_, i) => Number(out[i * 2]));
  },
  async lock(key, ttl) {
    const [ok] = await pipeline([["SET", key, "1", "NX", "EX", ttl]]);
    return ok === "OK";
  },
  async del(key) {
    await pipeline([["DEL", key]]);
  },
  async getText(key) {
    const [v] = await pipeline([["GET", key]]);
    return typeof v === "string" ? v : null;
  },
  async setText(key, value, ttl) {
    await pipeline([["SET", key, value, "EX", ttl]]);
  },
};

export async function withStore<T>(fn: (s: Store) => Promise<T>): Promise<T> {
  if (!sharedLimits) return fn(memory);
  try {
    return await fn(redis);
  } catch (err) {
    console.error("[limits] Redis unavailable, using in-memory limits:", (err as Error).message.slice(0, 200));
    return fn(memory);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- per IP ----------
/** Counts a chat request against the caller's IP; false when the IP sent too many in 10 minutes. */
export function burstOk(ip: string, now = Date.now()): Promise<boolean> {
  const key = `gk:ip:${ip}:${Math.floor(now / (PER_IP_WINDOW_S * 1000))}`;
  return withStore(async s => (await s.incr([key], PER_IP_WINDOW_S))[0]! <= PER_IP_LIMIT);
}

/** Counts any API request against the caller's IP; false when the IP sent too many this minute. */
export function apiRateOk(ip: string, now = Date.now()): Promise<boolean> {
  const key = `gk:ipa:${ip}:${Math.floor(now / 60_000)}`;
  return withStore(async s => (await s.incr([key], 60))[0]! <= IP_API_PER_MIN);
}

// ---------- per account ----------
const userKey = (who: string, now: number) => `gk:u:${who}:${istDay(now)}`;
const periodKey = (who: string, id: string) => `gk:p:${who}:${id}`;
const poolKey = (now: number) => `gk:pool:${geminiDay(now)}`;
const globalKey = (now: number) => `gk:all:${geminiDay(now)}`;
const rateKey = (now: number) => `gk:rate:${Math.floor(now / (RATE_WINDOW_S * 1000))}`;

export interface Usage {
  today: number;
  /** Chats used in the plan's period (trial total or this month), when the plan has one. */
  period: number | null;
}

export function usage(who: string, e: Pick<Entitlement, "period">, now = Date.now()): Promise<Usage> {
  return withStore(async s => {
    const [today, period] = await s.get([userKey(who, now), ...(e.period ? [periodKey(who, e.period.id)] : [])]);
    return { today: today!, period: e.period ? period! : null };
  });
}

/** One answer at a time per account. Returns a release function, or null when one is already running. */
export async function lockUser(who: string): Promise<(() => Promise<void>) | null> {
  const key = `gk:lock:${who}`;
  const got = await withStore(s => s.lock(key, LOCK_TTL_S));
  return got ? () => withStore(s => s.del(key)).catch(() => {}) : null;
}

/** Waits for room in the global 10-second window; false when none frees up within `waitMs`. */
async function admit(s: Store, waitMs: number, onWait?: () => void, now = () => Date.now()): Promise<boolean> {
  const deadline = now() + waitMs;
  let waited = false;
  for (;;) {
    const key = rateKey(now());
    const [n] = await s.get([key]);
    if (n! < PER_RATE_WINDOW) {
      await s.incr([key], RATE_WINDOW_S * 2);
      return true;
    }
    const nextWindow = (Math.floor(now() / (RATE_WINDOW_S * 1000)) + 1) * RATE_WINDOW_S * 1000;
    if (nextWindow >= deadline) return false;
    if (!waited) onWait?.();
    waited = true;
    // Spread waiting requests over the start of the next window so they don't all retry at once.
    await sleep(nextWindow - now() + Math.random() * 1000);
  }
}

export interface TakeOptions {
  /**
   * Whether the chat calls the model, and so uses the shared daily budget and the rate window.
   * A cached answer only counts against the user's own limits.
   */
  model?: boolean;
  waitMs?: number;
  /** Called once if the chat has to wait for the rate window. */
  onWait?: () => void;
  now?: number;
}

/** Takes one chat from every counter that applies, or says which limit is reached. Rejected chats count nowhere. */
export function takeChat(who: string, e: Pick<Entitlement, "plan" | "dailyLimit" | "period">, opts: TakeOptions = {}): Promise<Verdict> {
  const { model = true, waitMs = QUEUE_WAIT_MS, now = Date.now() } = opts;
  return withStore(async s => {
    const own = [userKey(who, now), ...(e.period ? [periodKey(who, e.period.id)] : [])];
    const shared = model ? [globalKey(now), ...(e.plan === "free" ? [poolKey(now)] : [])] : [];
    const counts = await s.get([...own, ...shared]);
    const [user, period] = counts;
    const [all, pool] = counts.slice(own.length);
    if (user! >= e.dailyLimit) return "user";
    if (e.period && period! >= e.period.limit) return "period";
    if (model && all! >= GLOBAL_DAILY) return "global";
    if (model && e.plan === "free" && pool! >= FREE_POOL_DAILY) return "pool";
    if (model && !(await admit(s, waitMs, opts.onWait, opts.now === undefined ? undefined : () => now))) return "busy";
    await s.incr([userKey(who, now)], DAY_TTL_S);
    if (e.period) await s.incr([periodKey(who, e.period.id)], PERIOD_TTL_S);
    if (shared.length) await s.incr(shared, DAY_TTL_S);
    return "ok";
  });
}

/** Adds a chat's token use to daily totals per model, kept 90 days (gk:tok:<day>:<model>:<in|out>). */
export function recordTokens(model: string, input: number, output: number, now = Date.now()): Promise<void> {
  const day = geminiDay(now);
  return withStore(async s => {
    await s.incr([`gk:tok:${day}:${model}:in`], 90 * 24 * 3600, input);
    await s.incr([`gk:tok:${day}:${model}:out`], 90 * 24 * 3600, output);
  }).catch(() => {});
}
