// Sign-in with Clerk. The browser sends its Clerk session token as `Authorization: Bearer <token>`;
// the account's sign-up time and paid-until date come from the Clerk user (paidUntil lives in its
// public metadata, which only this server can write).
// Without CLERK_SECRET_KEY, sign-in is off and the advisor limits each IP like a free user.
import type { IncomingMessage } from "node:http";
import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Account } from "./plans";

const SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "";
const JWT_KEY = process.env.CLERK_JWT_KEY || undefined;
/** Origins allowed to use a session token, e.g. https://grantkosh.in. Empty = any (Clerk's default). */
const AUTHORIZED_PARTIES = (process.env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map(s => s.trim()).filter(Boolean);
/** Local UI testing only: accepts `Bearer mock-<id>` and keeps accounts in memory. Never in production. */
const MOCK = !SECRET_KEY && process.env.ADVISOR_MOCK === "1";

export const authEnabled = !!SECRET_KEY || MOCK;
const clerk = SECRET_KEY ? createClerkClient({ secretKey: SECRET_KEY, jwtKey: JWT_KEY }) : null;

export interface AccountInfo extends Account {
  id: string;
  email?: string;
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

export async function getAccount(id: string): Promise<AccountInfo> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.account;
  let account: AccountInfo;
  if (!clerk) {
    account = mockAccounts.get(id) ?? { id, createdAt: Date.now(), email: `${id}@example.test` };
    mockAccounts.set(id, account);
  } else {
    const u = await clerk.users.getUser(id);
    const paidUntil = Number(u.publicMetadata?.paidUntil) || undefined;
    account = {
      id,
      createdAt: u.createdAt,
      paidUntil,
      email: u.primaryEmailAddress?.emailAddress,
      phone: u.primaryPhoneNumber?.phoneNumber,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || undefined,
    };
  }
  if (cache.size > 10_000) cache.clear();
  cache.set(id, { at: Date.now(), account });
  return account;
}

/** Records billing state on the account. Only ever extends paid access via the caller's logic. */
export async function saveBilling(id: string, billing: { paidUntil?: number; subscriptionId?: string; subscriptionStatus?: string }) {
  cache.delete(id);
  if (!clerk) {
    const a = mockAccounts.get(id) ?? { id, createdAt: Date.now() };
    mockAccounts.set(id, { ...a, ...(billing.paidUntil ? { paidUntil: billing.paidUntil } : {}) });
    return;
  }
  await clerk.users.updateUserMetadata(id, { publicMetadata: billing });
}
