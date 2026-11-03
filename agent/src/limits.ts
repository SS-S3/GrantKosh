// Advisor rate limits:
//   burst    per IP, ADVISOR_PER_IP_LIMIT requests per 10 minutes (stops scripted abuse before any lookup)
//   user     per account per IST day, by plan (plans.ts): free 2, trial/paid 15 by default
//   pool     all free-plan chats per Gemini day, ADVISOR_FREE_POOL_DAILY, so free users cannot use up
//            the budget that trial and paid users rely on
//   global   all chats per Gemini day, ADVISOR_DAILY_LIMIT, a hard ceiling under the Gemini quota/budget
// A long-running server keeps the counters in memory. Serverless platforms (Vercel) run many short-lived
// instances that share no memory, so when Upstash Redis credentials are set the counters live there.
// If Redis is unreachable, the in-memory counters are used so the advisor keeps working.
import { geminiDay, istDay, type Plan } from "./plans";

export type Verdict = "ok" | "burst" | "user" | "pool" | "global";

const PER_IP_LIMIT = Number(process.env.ADVISOR_PER_IP_LIMIT ?? 12);
const PER_IP_WINDOW_S = 10 * 60;
const FREE_POOL_DAILY = Number(process.env.ADVISOR_FREE_POOL_DAILY ?? 300);
const GLOBAL_DAILY = Number(process.env.ADVISOR_DAILY_LIMIT ?? 2000);
const DAY_TTL_S = 2 * 24 * 3600;

// Vercel's Upstash integration sets KV_REST_API_*; a direct Upstash database gives UPSTASH_REDIS_REST_*.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
export const sharedLimits = !!(REDIS_URL && REDIS_TOKEN);

interface Store {
  get(keys: string[]): Promise<number[]>;
  incr(keys: string[], ttlSeconds: number): Promise<number[]>;
}

// ---------- in memory ----------
const counters = new Map<string, { n: number; expires: number }>();
const live = (key: string) => {
  const c = counters.get(key);
  if (c && c.expires <= Date.now()) counters.delete(key);
  return counters.get(key);
};
const memory: Store = {
  async get(keys) {
    return keys.map(k => live(k)?.n ?? 0);
  },
  async incr(keys, ttl) {
    if (counters.size > 50_000) for (const k of counters.keys()) live(k);
    return keys.map(k => {
      const c = live(k) ?? { n: 0, expires: Date.now() + ttl * 1000 };
      c.n++;
      counters.set(k, c);
      return c.n;
    });
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
  async incr(keys, ttl) {
    // Every key carries its day or window, so refreshing the TTL on each INCR is harmless.
    const out = await pipeline(keys.flatMap(k => [["INCR", k], ["EXPIRE", k, ttl]]));
    return keys.map((_, i) => Number(out[i * 2]));
  },
};

async function withStore<T>(fn: (s: Store) => Promise<T>): Promise<T> {
  if (!sharedLimits) return fn(memory);
  try {
    return await fn(redis);
  } catch (err) {
    console.error("[limits] Redis unavailable, using in-memory limits:", (err as Error).message.slice(0, 200));
    return fn(memory);
  }
}

// ---------- checks ----------
const userKey = (who: string, now: number) => `gk:u:${who}:${istDay(now)}`;
const poolKey = (now: number) => `gk:pool:${geminiDay(now)}`;
const globalKey = (now: number) => `gk:all:${geminiDay(now)}`;

/** Counts the request against the caller's IP; false when the IP sent too many in 10 minutes. */
export function burstOk(ip: string, now = Date.now()): Promise<boolean> {
  const key = `gk:ip:${ip}:${Math.floor(now / (PER_IP_WINDOW_S * 1000))}`;
  return withStore(async s => (await s.incr([key], PER_IP_WINDOW_S))[0]! <= PER_IP_LIMIT);
}

/** Chats used today by an account (or `ip:<addr>` when sign-in is off). */
export function usedToday(who: string, now = Date.now()): Promise<number> {
  return withStore(async s => (await s.get([userKey(who, now)]))[0]!);
}

/** Takes one chat from every counter that applies, or says which limit is reached. Rejected chats count nowhere. */
export function takeChat(who: string, plan: Plan, dailyLimit: number, now = Date.now()): Promise<Verdict> {
  return withStore(async s => {
    const keys = [userKey(who, now), globalKey(now), ...(plan === "free" ? [poolKey(now)] : [])];
    const [user, all, pool] = await s.get(keys);
    if (user! >= dailyLimit) return "user";
    if (all! >= GLOBAL_DAILY) return "global";
    if (plan === "free" && pool! >= FREE_POOL_DAILY) return "pool";
    await s.incr(keys, DAY_TTL_S);
    return "ok";
  });
}
