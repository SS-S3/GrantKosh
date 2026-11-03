// Advisor plans:
//   free   2 chats a day, on the cheaper Flash-Lite models (GEMINI_MODELS_FREE)
//   trial  5 chats a day and 80 in all, on Flash; for anyone who signs up before TRIAL_SIGNUP_DEADLINE
//   paid   15 chats a day and 120 per calendar month (IST), on Flash; needs a subscription (billing.ts),
//          which sets `paidUntil` on the account
// Every limit can be changed with the env vars below.

export type Plan = "free" | "trial" | "paid";

export interface Account {
  /** Sign-up time, ms since epoch. */
  createdAt: number;
  /** Paid access ends at this time, ms since epoch. Set by billing webhooks. */
  paidUntil?: number;
}

export interface Entitlement {
  plan: Plan;
  /** Chats allowed per day (resets at midnight IST). */
  dailyLimit: number;
  /** A cap over a longer period: the whole trial, or the calendar month on the paid plan. */
  period: Period | null;
  trialEndsAt: number | null;
  paidUntil: number | null;
}

export interface Period {
  /** Counter id, unique per period: "trial", or "m:2026-12" for a month. */
  id: string;
  kind: "trial" | "month";
  limit: number;
}

const DAY_MS = 24 * 3600 * 1000;
export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 30);
export const TRIAL_SIGNUP_DEADLINE = Date.parse(process.env.TRIAL_SIGNUP_DEADLINE ?? "2026-11-25T00:00:00+05:30");
export const PRICE_INR = Number(process.env.SUBSCRIPTION_PRICE_INR ?? 129);

export const DAILY_LIMITS: Record<Plan, number> = {
  free: Number(process.env.ADVISOR_FREE_DAILY ?? 2),
  trial: Number(process.env.ADVISOR_TRIAL_DAILY ?? 5),
  paid: Number(process.env.ADVISOR_PAID_DAILY ?? 15),
};
export const TRIAL_TOTAL = Number(process.env.ADVISOR_TRIAL_TOTAL ?? 80);
export const PAID_MONTHLY = Number(process.env.ADVISOR_PAID_MONTHLY ?? 120);

export function entitlement(acc: Account | null, now = Date.now()): Entitlement {
  const trialEndsAt = acc && acc.createdAt < TRIAL_SIGNUP_DEADLINE ? acc.createdAt + TRIAL_DAYS * DAY_MS : null;
  const paidUntil = acc?.paidUntil ?? null;
  const plan: Plan = paidUntil && paidUntil > now ? "paid" : trialEndsAt && trialEndsAt > now ? "trial" : "free";
  const period: Period | null =
    plan === "trial" ? { id: "trial", kind: "trial", limit: TRIAL_TOTAL } : plan === "paid" ? { id: `m:${istDay(now).slice(0, 7)}`, kind: "month", limit: PAID_MONTHLY } : null;
  return { plan, dailyLimit: DAILY_LIMITS[plan], period, trialEndsAt, paidUntil };
}

const dayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const IST = dayIn("Asia/Kolkata");
const PACIFIC = dayIn("America/Los_Angeles");

/** The user's day: per-user limits reset at midnight IST. */
export const istDay = (now = Date.now()) => IST.format(now);
/** Gemini's day: Google resets free-tier daily quotas at midnight Pacific time. */
export const geminiDay = (now = Date.now()) => PACIFIC.format(now);
