// Sign-in with Clerk. The browser sends its Clerk session token as `Authorization: Bearer <token>`;
// the account's sign-up time and paid-until date come from the Clerk user (paidUntil lives in its
// public metadata, which only this server can write).
// Without CLERK_SECRET_KEY, sign-in is off and the advisor limits each IP like a free user.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Account } from "./plans";

const SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const JWT_KEY = process.env.CLERK_JWT_KEY || undefined;
/**
 * Origins allowed to use a session token, e.g. https://grantkosh.in. Defaults to PUBLIC_URL, so a token
 * minted for another site can't be used here. Empty = any (Clerk's default).
 */
const AUTHORIZED_PARTIES = (process.env.CLERK_AUTHORIZED_PARTIES || (process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : "")).split(",").map(s => s.trim()).filter(Boolean);
/** Local UI testing only: accepts `Bearer mock-<id>` and keeps accounts in memory. Never in production. */
const MOCK = !SECRET_KEY && process.env.ADVISOR_MOCK === "1";

export const authEnabled = !!SECRET_KEY || MOCK;
const clerk = SECRET_KEY ? createClerkClient({ secretKey: SECRET_KEY, jwtKey: JWT_KEY }) : null;

export interface AccountInfo extends Account {
  id: string;
  email?: string;
  /** Primary phone number, only if Clerk has verified it (by OTP). */
  phone?: string;
  name?: string;
}

/** The signed-in user's id, or null for a missing, expired or forged token. */
export async function userIdFrom(req: IncomingMessage): Promise<string | null> {
  const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
  if (!token) return null;
  if (MOCK) return /^mock-([A-Za-z0-9]{1,40})$/.exec(token) ? `user_${token.slice(5)}` : null;
  try {
    const payload = await verifyToken(token, { secretKey: SECRET_KEY, jwtKey: JWT_KEY, authorizedParties: AUTHORIZED_PARTIES.length ? AUTHORIZED_PARTIES : undefined });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// One Clerk API call per user per minute per instance; billing changes clear the entry.
const cache = new Map<string, { at: number; account: AccountInfo }>();
const mockAccounts = new Map<string, AccountInfo>();

const mockPhone = (id: string) => `+9198${String(parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16) % 1e8).padStart(8, "0")}`;

export async function getAccount(id: string): Promise<AccountInfo> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.account;
  let account: AccountInfo;
  if (!clerk) {
    // Mock accounts get a verified phone derived from the id, so each test user has a different one.
    account = mockAccounts.get(id) ?? { id, createdAt: Date.now(), email: `${id}@example.test`, phone: mockPhone(id) };
    mockAccounts.set(id, account);
  } else {
    const u = await clerk.users.getUser(id);
    const paidUntil = Number(u.publicMetadata?.paidUntil) || undefined;
    const trialStartedAt = Number(u.publicMetadata?.trialStartedAt) || undefined;
    const phone = u.primaryPhoneNumber?.verification?.status === "verified" ? u.primaryPhoneNumber.phoneNumber : undefined;
    account = {
      id,
      createdAt: u.createdAt,
      paidUntil,
      trialStartedAt,
      email: u.primaryEmailAddress?.emailAddress,
      phone,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || undefined,
    };
  }
  if (cache.size > 10_000) cache.clear();
  cache.set(id, { at: Date.now(), account });
  return account;
}

/** Records billing state on the account. Only ever extends paid access via the caller's logic. */
export async function saveBilling(id: string, billing: { paidUntil?: number; subscriptionId?: string; subscriptionStatus?: string }) {
  await saveMetadata(id, billing);
}

/** Records the trial claim on the account. Only a masked company id is kept, never the full CIN/PAN. */
export async function saveTrial(id: string, trial: { trialStartedAt: number; companyIdType: string; companyIdMasked: string }) {
  await saveMetadata(id, trial);
}

async function saveMetadata(id: string, data: Record<string, unknown>) {
  cache.delete(id);
  if (!clerk) {
    const a = mockAccounts.get(id) ?? { id, createdAt: Date.now() };
    const known = Object.fromEntries(Object.entries(data).filter(([k, v]) => (k === "paidUntil" || k === "trialStartedAt") && v));
    mockAccounts.set(id, { ...a, ...known });
    return;
  }
  // Clerk merges public metadata one level deep, so other keys are kept.
  await clerk.users.updateUserMetadata(id, { publicMetadata: data });
}
