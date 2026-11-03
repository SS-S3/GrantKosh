// Free trial claims: one trial per company and per phone number.
// The person enters their company's CIN, LLPIN or PAN; their phone number must already be verified by
// Clerk (OTP). Each company id and phone number can start a trial once, ever. Uniqueness is kept in
// Redis (limits.ts) under salted hashes, so the store never holds a full CIN, PAN or phone number;
// the account keeps only a masked id ("PAN ••••••234F").
//
// This checks format and uniqueness, not that the company exists. A paid verification API (e.g.
// Cashfree's PAN/CIN verification) can be called before reserveTrial when that matters.
import { createHmac } from "node:crypto";
import { withStore } from "./limits";

export type CompanyIdType = "CIN" | "LLPIN" | "PAN";

const SALT = process.env.TRIAL_ID_SALT || "grantkosh-trial";

const FORMATS: Array<[CompanyIdType, RegExp]> = [
  // Company Identification Number, e.g. U72900KA2019PTC123456
  ["CIN", /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/],
  // Limited Liability Partnership Identification Number, e.g. AAB-1234
  ["LLPIN", /^[A-Z]{3}-\d{4}$/],
  // Permanent Account Number, e.g. AAACB1234F
  ["PAN", /^[A-Z]{5}\d{4}[A-Z]$/],
];

/** Normalises and recognises a company id; null if it matches no known format. */
export function parseCompanyId(raw: string): { type: CompanyIdType; value: string } | null {
  const value = raw.toUpperCase().replace(/[\s.]/g, "");
  for (const [type, re] of FORMATS) if (re.test(value)) return { type, value };
  return null;
}

export const maskCompanyId = (type: CompanyIdType, value: string) => `${type} ${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;

const claimKey = (kind: "company" | "phone", value: string) => `gk:trial:${kind}:${createHmac("sha256", SALT).update(value).digest("base64url")}`;

export type ClaimResult = { ok: true } | { ok: false; reason: "company" | "phone" };

/**
 * Reserves the company id and phone number for this account. Both are reserved or neither is.
 * The same account may retry (e.g. after a failed save) without being told the id is taken.
 */
export async function reserveTrial(userId: string, companyId: string, phone: string): Promise<ClaimResult> {
  const company = claimKey("company", companyId);
  const phoneKey = claimKey("phone", phone.replace(/\D/g, "").slice(-10));
  return withStore(async s => {
    if (!(await s.lock(company, 10 * 365 * 24 * 3600)) && (await s.getText(company)) !== userId) return { ok: false, reason: "company" };
    await s.setText(company, userId, 10 * 365 * 24 * 3600);
    if (!(await s.lock(phoneKey, 10 * 365 * 24 * 3600)) && (await s.getText(phoneKey)) !== userId) {
      await s.del(company);
      return { ok: false, reason: "phone" };
    }
    await s.setText(phoneKey, userId, 10 * 365 * 24 * 3600);
    return { ok: true };
  });
}

/** Undoes a reservation when the claim couldn't be saved on the account. */
export async function releaseTrial(companyId: string, phone: string): Promise<void> {
  await withStore(async s => {
    await s.del(claimKey("company", companyId));
    await s.del(claimKey("phone", phone.replace(/\D/g, "").slice(-10)));
  }).catch(() => {});
}
