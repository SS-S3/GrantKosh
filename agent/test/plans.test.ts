import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { billingUpdate, firstChargeAt, subscriptionIdFor, userIdFromSubscription, verifyWebhook } from "../src/billing";
import { cacheKey, getCached, putCached } from "../src/cache";
import { takeChat, usage } from "../src/limits";
import { canClaimTrial, entitlement, istDay } from "../src/plans";
import { maskCompanyId, parseCompanyId, releaseTrial, reserveTrial } from "../src/trial";

const DAY = 24 * 3600 * 1000;
const at = (iso: string) => Date.parse(iso);

describe("entitlement", () => {
  it("runs the trial for 30 days from when it was claimed", () => {
    const claimed = at("2026-11-24T23:59:00+05:30");
    const acc = { createdAt: claimed - DAY, trialStartedAt: claimed };
    expect(entitlement(acc, claimed + 29 * DAY)).toMatchObject({ plan: "trial", dailyLimit: 5, period: { kind: "trial", limit: 80 }, trialEndsAt: claimed + 30 * DAY });
    expect(entitlement(acc, claimed + 31 * DAY).plan).toBe("free");
  });

  it("gives no trial until one is claimed, and claims close on 25 Nov 2026 IST", () => {
    const created = at("2026-11-10T10:00:00+05:30");
    expect(entitlement({ createdAt: created }, created + DAY)).toMatchObject({ plan: "free", dailyLimit: 2, period: null, trialEndsAt: null });
    expect(canClaimTrial({ createdAt: created }, at("2026-11-24T23:59:00+05:30"))).toBe(true);
    expect(canClaimTrial({ createdAt: created }, at("2026-11-25T00:00:00+05:30"))).toBe(false);
    expect(canClaimTrial({ createdAt: created, trialStartedAt: created }, created + DAY)).toBe(false);
  });

  it("treats paid access as paid, during or after a trial", () => {
    const now = at("2026-12-30T10:00:00Z");
    expect(entitlement({ createdAt: at("2026-12-01T00:00:00Z"), paidUntil: now + DAY }, now)).toMatchObject({ plan: "paid", dailyLimit: 15, period: { id: "m:2026-12", limit: 120 } });
    expect(entitlement({ createdAt: at("2026-12-01T00:00:00Z"), paidUntil: now - 1 }, now).plan).toBe("free");
    expect(entitlement(null, now).plan).toBe("free");
  });
});

describe("limits", () => {
  const free = { plan: "free" as const, dailyLimit: 2, period: null };
  const who = () => `test-${Math.random()}`;

  it("allows a free user 2 chats per IST day", async () => {
    const now = at("2026-12-01T10:00:00+05:30");
    const id = who();
    expect(await takeChat(id, free, { now })).toBe("ok");
    expect(await takeChat(id, free, { now })).toBe("ok");
    expect(await takeChat(id, free, { now })).toBe("user");
    expect((await usage(id, free, now)).today).toBe(2);
    // Midnight IST starts a new day.
    expect(await takeChat(id, free, { now: at("2026-12-02T00:00:01+05:30") })).toBe("ok");
  });

  it("stops a trial at its total even with chats left today", async () => {
    const trial = { plan: "trial" as const, dailyLimit: 5, period: { id: "trial", kind: "trial" as const, limit: 3 } };
    const id = who();
    for (let day = 1; day <= 3; day++) expect(await takeChat(id, trial, { now: at(`2026-11-0${day}T09:00:00Z`) })).toBe("ok");
    expect(await takeChat(id, trial, { now: at("2026-11-04T09:00:00Z") })).toBe("period");
    expect(await usage(id, trial, at("2026-11-04T09:00:00Z"))).toEqual({ today: 0, period: 3 });
  });

  it("turns chats away as busy when the 10-second window is full and no wait is allowed", async () => {
    const now = at("2026-12-05T10:00:00Z");
    const paid = { plan: "paid" as const, dailyLimit: 15, period: null };
    for (let i = 0; i < 10; i++) expect(await takeChat(who(), paid, { now, waitMs: 0 })).toBe("ok");
    const id = who();
    expect(await takeChat(id, paid, { now, waitMs: 0 })).toBe("busy");
    // A busy refusal costs the user nothing, and a cached answer needs no room in the window.
    expect((await usage(id, paid, now)).today).toBe(0);
    expect(await takeChat(id, paid, { now, waitMs: 0, model: false })).toBe("ok");
  });

  it("uses the IST date", () => {
    expect(istDay(at("2026-12-01T19:00:00Z"))).toBe("2026-12-02");
  });
});

describe("answer cache", () => {
  it("replays a finished single-question answer for the same tier and data", async () => {
    const key = cacheKey([{ role: "user", content: "Grants for  drones? " }], "flash", "d1")!;
    expect(cacheKey([{ role: "user", content: "grants for drones" }], "flash", "d1")).toBe(key);
    expect(cacheKey([{ role: "user", content: "grants for drones" }], "free", "d1")).not.toBe(key);
    expect(cacheKey([{ role: "user", content: "grants for drones" }], "flash", "d2")).not.toBe(key);
    expect(cacheKey([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }], "flash", "d1")).toBeNull();

    await putCached(key, [{ type: "status", text: "…" }, { type: "text", delta: "Try " }, { type: "text", delta: "iDEX" }, { type: "done", model: "m1" }]);
    expect(await getCached(key)).toEqual([{ type: "text", delta: "Try iDEX" }, { type: "done", model: "m1" }]);
  });

  it("never stores a failed answer", async () => {
    const key = cacheKey([{ role: "user", content: "failing question" }], "flash", "d1")!;
    await putCached(key, [{ type: "text", delta: "Half" }, { type: "error", code: "quota", message: "x" }]);
    expect(await getCached(key)).toBeNull();
  });
});

describe("Cashfree billing", () => {
  it("round-trips the Clerk user id through the subscription id", () => {
    const id = subscriptionIdFor("user_2abcDEF123");
    expect(id).toMatch(/^gk-2abcDEF123-[a-z0-9]+$/);
    expect(userIdFromSubscription(id)).toBe("user_2abcDEF123");
    expect(userIdFromSubscription("someone-else")).toBeNull();
  });

  it("charges first when the trial ends, never within 26 hours", () => {
    const now = at("2026-11-20T00:00:00Z");
    expect(firstChargeAt(now + 10 * DAY, now)).toBe(now + 10 * DAY);
    expect(firstChargeAt(null, now)).toBe(now + 26 * 3600 * 1000);
  });

  it("verifies the webhook signature over timestamp + raw body", () => {
    const body = Buffer.from('{"type":"SUBSCRIPTION_PAYMENT_SUCCESS"}');
    const sig = createHmac("sha256", "secret").update(`1700000000${body}`).digest("base64");
    expect(verifyWebhook(body, "1700000000", sig, "secret")).toBe(true);
    expect(verifyWebhook(body, "1700000001", sig, "secret")).toBe(false);
    expect(verifyWebhook(body, "1700000000", undefined, "secret")).toBe(false);
  });

  it("extends paid access on each monthly charge, not on the ₹1 authorisation", () => {
    const now = at("2026-12-01T00:00:00Z");
    const sub = "gk-2abc-xyz";
    const charge = { type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: { subscription_id: sub, payment_status: "SUCCESS", payment_type: "CHARGE" } };
    expect(billingUpdate(charge, 0, now)).toEqual({ userId: "user_2abc", subscriptionId: sub, paidUntil: now + 33 * DAY });
    // Never shortens access that already runs longer.
    expect(billingUpdate(charge, now + 60 * DAY, now)?.paidUntil).toBe(now + 60 * DAY);
    expect(billingUpdate({ ...charge, data: { ...charge.data, payment_type: "AUTH" } }, 0, now)).toBeNull();
  });

  it("grants access from mandate approval until just after the first charge", () => {
    const now = at("2026-12-01T00:00:00Z");
    const update = billingUpdate(
      { type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: "gk-2abc-xyz", subscription_status: "ACTIVE", subscription_first_charge_time: "2026-12-10T10:00:00" } } },
      0,
      now,
    );
    expect(update?.paidUntil).toBe(at("2026-12-10T10:00:00+05:30") + 2 * DAY);
    const cancelled = billingUpdate({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: "gk-2abc-xyz", subscription_status: "CANCELLED" } } }, 0, now);
    expect(cancelled).toEqual({ userId: "user_2abc", subscriptionId: "gk-2abc-xyz", subscriptionStatus: "CANCELLED" });
  });
});

describe("trial claims", () => {
  it("recognises CIN, LLPIN and PAN, and masks them", () => {
    expect(parseCompanyId(" u72900ka2019ptc123456 ")).toEqual({ type: "CIN", value: "U72900KA2019PTC123456" });
    expect(parseCompanyId("aab-1234")).toEqual({ type: "LLPIN", value: "AAB-1234" });
    expect(parseCompanyId("AAACB 1234F")).toEqual({ type: "PAN", value: "AAACB1234F" });
    expect(parseCompanyId("12345")).toBeNull();
    expect(maskCompanyId("PAN", "AAACB1234F")).toBe("PAN ••••••234F");
  });

  it("allows one trial per company and per phone number", async () => {
    const pan = `AAACB${Math.floor(1000 + Math.random() * 8999)}F`;
    const phone = `+9198${Math.floor(1e7 + Math.random() * 8e7)}`;
    expect(await reserveTrial("user_a", pan, phone)).toEqual({ ok: true });
    // The same account may retry; another account may not reuse the company or the phone.
    expect(await reserveTrial("user_a", pan, phone)).toEqual({ ok: true });
    expect(await reserveTrial("user_b", pan, "+919000000001")).toEqual({ ok: false, reason: "company" });
    expect(await reserveTrial("user_b", "U72900KA2019PTC000001", phone)).toEqual({ ok: false, reason: "phone" });
    // A refused claim doesn't hold on to the company id it tried.
    expect(await reserveTrial("user_c", "U72900KA2019PTC000001", "+919000000002")).toEqual({ ok: true });
    await releaseTrial(pan, phone);
    expect(await reserveTrial("user_b", pan, "+919000000003")).toEqual({ ok: true });
  });
});
