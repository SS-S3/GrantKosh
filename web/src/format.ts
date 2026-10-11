import type { Opportunity } from "./types";

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

/** ₹ amounts in lakh/crore; other currencies in K/M. */
export function money(value: number | null, currency: string | null): string {
  if (value == null || !currency) return "";
  const sym = SYMBOL[currency] ?? `${currency} `;
  if (currency === "INR") {
    if (value >= 1e7) return `${sym}${trim(value / 1e7)}Cr`;
    if (value >= 1e5) return `${sym}${trim(value / 1e5)}L`;
    return `${sym}${value.toLocaleString("en-IN")}`;
  }
  if (value >= 1e9) return `${sym}${trim(value / 1e9)}B`;
  if (value >= 1e6) return `${sym}${trim(value / 1e6)}M`;
  if (value >= 1e4) return `${sym}${trim(value / 1e3)}K`;
  return `${sym}${value.toLocaleString("en-US")}`;
}
const trim = (n: number) => String(+n.toFixed(n >= 100 ? 0 : 2));

export function amountLabel(o: Opportunity): string {
  if (o.amountMax == null) return "";
  if (o.amountMin != null && o.amountMin < o.amountMax) return `${money(o.amountMin, o.currency)} – ${money(o.amountMax, o.currency)}`;
  return `Up to ${money(o.amountMax, o.currency)}`;
}

const DAY = 86_400_000;
export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / DAY);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Closes today!", "Closes in 5 days", "Rolling / open", "Closed 3 Sep 2026"… */
export function deadlineLabel(o: Opportunity, today: string): { text: string; tone: "urgent" | "soon" | "ok" | "muted" } {
  if (o.status === "closed") return { text: o.deadline ? `Closed ${fmtDate(o.deadline)}` : "Closed", tone: "muted" };
  if (o.status === "upcoming") return { text: o.opensAt ? `Opens ${fmtDate(o.opensAt)}` : "Opening soon", tone: "ok" };
  if (o.deadline) {
    const d = daysUntil(o.deadline, today);
    if (d <= 0) return { text: "Closes today!", tone: "urgent" };
    if (d === 1) return { text: "Closes tomorrow", tone: "urgent" };
    if (d <= 7) return { text: `Closes in ${d} days`, tone: "urgent" };
    if (d <= 30) return { text: `Closes in ${d} days`, tone: "soon" };
    return { text: `Closes ${fmtDate(o.deadline)}`, tone: "ok" };
  }
  if (o.status === "rolling") return { text: "Rolling / open", tone: "ok" };
  return { text: "Check official page for dates", tone: "muted" };
}

export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
