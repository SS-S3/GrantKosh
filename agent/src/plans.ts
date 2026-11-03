// Advisor plans. Free users get a few chats a day; trial and paid users get more.
// Launch offer: anyone who signs up before TRIAL_SIGNUP_DEADLINE gets TRIAL_DAYS of the paid plan.
// After that the paid plan needs a subscription (billing.ts), which sets `paidUntil` on the account.

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
  trialEndsAt: number | null;
  paidUntil: number | null;
}

const DAY_MS = 24 * 3600 * 1000;
export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 30);
export const TRIAL_SIGNUP_DEADLINE = Date.parse(process.env.TRIAL_SIGNUP_DEADLINE ?? "2026-11-25T00:00:00+05:30");
export const PRICE_INR = Number(process.env.SUBSCRIPTION_PRICE_INR ?? 101);

export const DAILY_LIMITS: Record<Plan, number> = {
  free: Number(process.env.ADVISOR_FREE_DAILY ?? 2),
  trial: Number(process.env.ADVISOR_PAID_DAILY ?? 15),
  paid: Number(process.env.ADVISOR_PAID_DAILY ?? 15),
};

export function entitlement(acc: Account | null, now = Date.now()): Entitlement {
  const trialEndsAt = acc && acc.createdAt < TRIAL_SIGNUP_DEADLINE ? acc.createdAt + TRIAL_DAYS * DAY_MS : null;
  const paidUntil = acc?.paidUntil ?? null;
  const plan: Plan = paidUntil && paidUntil > now ? "paid" : trialEndsAt && trialEndsAt > now ? "trial" : "free";
  return { plan, dailyLimit: DAILY_LIMITS[plan], trialEndsAt, paidUntil };
}

const dayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const IST = dayIn("Asia/Kolkata");
const PACIFIC = dayIn("America/Los_Angeles");

/** The user's day: per-user limits reset at midnight IST. */
export const istDay = (now = Date.now()) => IST.format(now);
/** Gemini's day: Google resets free-tier daily quotas at midnight Pacific time. */
export const geminiDay = (now = Date.now()) => PACIFIC.format(now);
