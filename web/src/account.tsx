// Sign-in (Clerk) and the Advisor plan. Everything except the Advisor chat works without an account.
// Build with VITE_CLERK_PUBLISHABLE_KEY to turn sign-in on; without it the Advisor is limited per visitor.
// For local UI testing against a server started with ADVISOR_MOCK=1, set VITE_MOCK_USER=<id> instead.
import { ClerkProvider, SignInButton, UserButton, useAuth } from "@clerk/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const MOCK_USER = import.meta.env.VITE_MOCK_USER as string | undefined;

export interface Me {
  signedIn: boolean;
  trialDays: number;
  trialSignupDeadline: string;
  priceInr: number;
  freeDaily: number;
  paidDaily: number;
  paidMonthly: number;
  plan?: "free" | "trial" | "paid";
  dailyLimit?: number;
  usedToday?: number;
  /** The trial's total allowance, or the paid plan's monthly one. */
  period?: { kind: "trial" | "month"; limit: number; used: number } | null;
  trialEndsAt?: string | null;
  paidUntil?: string | null;
  canSubscribe?: boolean;
}

interface AccountState {
  /** Sign-in is available on this build. */
  enabled: boolean;
  signedIn: boolean;
  me: Me | null;
  /** Headers for API calls: the session token when signed in. */
  authHeaders(): Promise<Record<string, string>>;
  refresh(): Promise<Me | null>;
}

const AccountContext = createContext<AccountState>({ enabled: false, signedIn: false, me: null, authHeaders: async () => ({}), refresh: async () => null });
export const useAccount = () => useContext(AccountContext);

function useMe(signedIn: boolean, ready: boolean, authHeaders: () => Promise<Record<string, string>>) {
  const [me, setMe] = useState<Me | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("api/me", { headers: await authHeaders() });
      const next = res.ok ? ((await res.json()) as Me) : null;
      setMe(next);
      return next;
    } catch {
      return null;
    }
  }, [authHeaders]);
  useEffect(() => {
    if (ready) void refresh();
  }, [ready, signedIn, refresh]);
  return { me, refresh };
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = isSignedIn ? await getToken() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [isSignedIn, getToken]);
  const { me, refresh } = useMe(!!isSignedIn, isLoaded, authHeaders);
  return <AccountContext.Provider value={{ enabled: true, signedIn: !!isSignedIn, me, authHeaders, refresh }}>{children}</AccountContext.Provider>;
}

function NoClerkBridge({ children }: { children: ReactNode }) {
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => (MOCK_USER ? { Authorization: `Bearer mock-${MOCK_USER}` } : {}), []);
  const { me, refresh } = useMe(!!MOCK_USER, true, authHeaders);
  return <AccountContext.Provider value={{ enabled: !!MOCK_USER, signedIn: !!MOCK_USER, me, authHeaders, refresh }}>{children}</AccountContext.Provider>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  return CLERK_KEY ? (
    <ClerkProvider publishableKey={CLERK_KEY}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  ) : (
    <NoClerkBridge>{children}</NoClerkBridge>
  );
}

/** Header control: a sign-in button, or the Clerk account menu once signed in. */
export function AccountMenu() {
  const { enabled, signedIn } = useAccount();
  if (!enabled || !CLERK_KEY) return null;
  return signedIn ? (
    <UserButton />
  ) : (
    <SignInButton mode="modal">
      <button className="btn btn-sm">Sign in</button>
    </SignInButton>
  );
}

export function SignInCta({ label = "Sign in" }: { label?: string }) {
  if (!CLERK_KEY) return null;
  return (
    <SignInButton mode="modal">
      <button className="btn btn-primary btn-sm">{label}</button>
    </SignInButton>
  );
}

// ---------- Cashfree subscription checkout ----------
type CashfreeFactory = (opts: { mode: "sandbox" | "production" }) => {
  subscriptionsCheckout(opts: { subsSessionId: string; redirectTarget: "_self" }): Promise<{ error?: { message: string } }>;
};

let sdk: Promise<CashfreeFactory> | null = null;
function loadCashfree(): Promise<CashfreeFactory> {
  // Cashfree requires its SDK to load from its CDN; it is fetched only when someone subscribes.
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.onload = () => resolve((window as unknown as { Cashfree: CashfreeFactory }).Cashfree);
    s.onerror = () => {
      sdk = null;
      reject(new Error("Couldn't load the payment page. Check your connection and try again."));
    };
    document.head.append(s);
  });
  return sdk;
}

/** Creates the subscription on the server, then hands over to Cashfree's checkout page. */
export async function startSubscription(phone: string, authHeaders: Record<string, string>): Promise<void> {
  const res = await fetch("api/billing/subscribe", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ phone }) });
  const body = (await res.json().catch(() => ({}))) as { sessionId?: string; mode?: "sandbox" | "production"; error?: string };
  if (!res.ok || !body.sessionId) throw new Error(body.error ?? `Couldn't start the payment (HTTP ${res.status}).`);
  const Cashfree = await loadCashfree();
  const result = await Cashfree({ mode: body.mode ?? "sandbox" }).subscriptionsCheckout({ subsSessionId: body.sessionId, redirectTarget: "_self" });
  if (result?.error) throw new Error(result.error.message);
}
