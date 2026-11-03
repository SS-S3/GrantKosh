// Monthly subscription through Cashfree Subscriptions (UPI AutoPay, cards, e-NACH).
// Set-up (Cashfree dashboard): create a PERIODIC plan of SUBSCRIPTION_PRICE_INR every 1 month and put its
// id in CASHFREE_PLAN_ID; point the subscription webhook at https://<site>/api/billing/webhook.
//
// Flow: POST /api/billing/subscribe creates a subscription for the signed-in user and returns its
// session id; the browser opens Cashfree checkout with it; Cashfree calls the webhook as the mandate is
// approved and as each month is charged, and the webhook extends the account's paidUntil.
// The Cashfree subscription id embeds the Clerk user id, so the webhook needs no database lookup.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CLIENT_ID = process.env.CASHFREE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.CASHFREE_CLIENT_SECRET ?? "";
const PLAN_ID = process.env.CASHFREE_PLAN_ID ?? "";
const WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET || CLIENT_SECRET;
export const CASHFREE_MODE = process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
const BASE = CASHFREE_MODE === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
const API_VERSION = "2025-01-01";

export const billingEnabled = !!(CLIENT_ID && CLIENT_SECRET && PLAN_ID);

const DAY_MS = 24 * 3600 * 1000;
/** Each successful monthly charge pays for this long; the extra days cover retries of a late charge. */
const PAID_PERIOD_MS = 33 * DAY_MS;
/** Access from mandate approval until a little after the first charge is due. */
const FIRST_CHARGE_GRACE_MS = 2 * DAY_MS;
/** UPI AutoPay sends a pre-debit notice 24 hours ahead, so the first charge can't be sooner. */
const MIN_FIRST_CHARGE_DELAY_MS = 26 * 3600 * 1000;

export function subscriptionIdFor(userId: string, now = Date.now()): string {
  return `gk-${userId.replace(/^user_/, "")}-${now.toString(36)}${randomBytes(2).toString("hex")}`;
}

export function userIdFromSubscription(subscriptionId: string): string | null {
  const m = /^gk-([A-Za-z0-9]+)-[a-z0-9]+$/.exec(subscriptionId);
  return m ? `user_${m[1]}` : null;
}

/** First charge when current access (trial or paid) runs out, never sooner than the pre-debit notice allows. */
export function firstChargeAt(accessEndsAt: number | null, now = Date.now()): number {
  return Math.max(accessEndsAt ?? 0, now + MIN_FIRST_CHARGE_DELAY_MS);
}

export interface NewSubscription {
  userId: string;
  email: string;
  phone: string;
  name?: string;
  firstChargeAt: number;
  returnUrl: string;
}

export async function createSubscription(s: NewSubscription): Promise<{ sessionId: string; subscriptionId: string }> {
  const subscriptionId = subscriptionIdFor(s.userId);
  const res = await fetch(`${BASE}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-version": API_VERSION, "x-client-id": CLIENT_ID, "x-client-secret": CLIENT_SECRET },
    body: JSON.stringify({
      subscription_id: subscriptionId,
      customer_details: { customer_name: s.name, customer_email: s.email, customer_phone: s.phone },
      plan_details: { plan_id: PLAN_ID },
      // ₹1 to verify the payment method, refunded by Cashfree.
      authorization_details: { authorization_amount: 1, authorization_amount_refund: true },
      subscription_meta: { return_url: s.returnUrl },
      subscription_first_charge_time: new Date(s.firstChargeAt).toISOString(),
      subscription_expiry_time: new Date(Date.now() + 5 * 365 * DAY_MS).toISOString(),
      subscription_tags: { user_id: s.userId },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { subscription_session_id?: string; message?: string };
  if (!res.ok || !body.subscription_session_id) throw new Error(`Cashfree ${res.status}: ${body.message ?? "no session id"}`);
  return { sessionId: body.subscription_session_id, subscriptionId };
}

/** Cashfree signs `timestamp + raw body` with HMAC-SHA256 and sends it base64-encoded. */
export function verifyWebhook(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined, secret = WEBHOOK_SECRET): boolean {
  if (!timestamp || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(timestamp).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WebhookEvent {
  type: string;
  data?: {
    subscription_id?: string;
    payment_type?: string;
    payment_status?: string;
    subscription_details?: { subscription_id?: string; subscription_status?: string; subscription_first_charge_time?: string | null };
  };
}

/** Cashfree times without an offset are IST. */
const parseCashfreeTime = (t: string | null | undefined) => (t ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}+05:30`) : NaN);

export interface BillingUpdate {
  userId: string;
  subscriptionId: string;
  paidUntil?: number;
  subscriptionStatus?: string;
}

/**
 * What a webhook changes on the account. paidUntil only ever moves forward, so repeated or
 * out-of-order deliveries are harmless; a cancelled or failed subscription simply stops being extended.
 */
export function billingUpdate(event: WebhookEvent, currentPaidUntil = 0, now = Date.now()): BillingUpdate | null {
  const subscriptionId = event.data?.subscription_id ?? event.data?.subscription_details?.subscription_id;
  const userId = subscriptionId ? userIdFromSubscription(subscriptionId) : null;
  if (!subscriptionId || !userId) return null;

  if (event.type === "SUBSCRIPTION_PAYMENT_SUCCESS" && event.data?.payment_status === "SUCCESS" && event.data.payment_type !== "AUTH") {
    return { userId, subscriptionId, paidUntil: Math.max(currentPaidUntil, now + PAID_PERIOD_MS) };
  }
  if (event.type === "SUBSCRIPTION_STATUS_CHANGED") {
    const status = event.data?.subscription_details?.subscription_status;
    if (status !== "ACTIVE") return { userId, subscriptionId, subscriptionStatus: status };
    const first = parseCashfreeTime(event.data?.subscription_details?.subscription_first_charge_time);
    return { userId, subscriptionId, subscriptionStatus: status, paidUntil: Math.max(currentPaidUntil, (Number.isFinite(first) ? first : now) + FIRST_CHARGE_GRACE_MS) };
  }
  return null;
}
