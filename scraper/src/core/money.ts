// Extract funding amounts from free text: "₹50 lakh", "Rs. 1.5 Cr", "up to INR 25,00,000",
// "£2,500", "EUR 50,000", "$100k", "€2 million".

export type Currency = "INR" | "USD" | "EUR" | "GBP";

export interface Amount {
  value: number;
  currency: Currency;
  index: number;
}

/**
 * Rough conversion rates to INR. Used only to sort and filter amounts across currencies;
 * the UI always shows the source's own currency.
 */
export const FX_TO_INR: Record<Currency, number> = { INR: 1, USD: 88, EUR: 102, GBP: 118 };

const SYMBOL: Array<[RegExp, Currency]> = [
  [/^(₹|rs\.?|inr|rupees?)$/i, "INR"],
  [/^(\$|usd|us\$)$/i, "USD"],
  [/^(€|eur|euros?)$/i, "EUR"],
  [/^(£|gbp)$/i, "GBP"],
];

const SCALE: Array<[RegExp, number]> = [
  [/^(lakhs?|lacs?|lac|l)$/i, 1e5],
  [/^(crores?|cr|crs)$/i, 1e7],
  [/^(million|mn|m)$/i, 1e6],
  [/^(billion|bn|b)$/i, 1e9],
  [/^(thousand|k)$/i, 1e3],
];

const NUM = "(\\d{1,3}(?:,\\d{2,3})+|\\d+(?:\\.\\d+)?)";
const CUR_BEFORE = "(₹|rs\\.?|inr|\\$|us\\$|usd|€|eur|£|gbp)";
const UNIT = "(lakhs?|lacs?|lac|crores?|crs?|million|mn|billion|bn|thousand|k|l|m)?";
const CUR_AFTER = "(rupees|inr|usd|euros?|eur|gbp)?";

// "₹ 50 lakh", "Rs.1.5Cr", "$100k"
const BEFORE = new RegExp(`${CUR_BEFORE}\\s*${NUM}\\s*${UNIT}\\b`, "gi");
// "50 lakh rupees", "25 lakh", "1.5 crore", "50,000 EUR"
const AFTER = new RegExp(`\\b${NUM}\\s*${UNIT}\\s*${CUR_AFTER}\\b`, "gi");

function currencyOf(token: string | undefined): Currency | null {
  if (!token) return null;
  for (const [re, c] of SYMBOL) if (re.test(token.trim())) return c;
  return null;
}

function scaleOf(token: string | undefined): number {
  if (!token) return 1;
  for (const [re, n] of SCALE) if (re.test(token)) return n;
  return 1;
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/** All amounts mentioned in text. Bare numbers without a currency or an Indian unit are ignored. */
export function findAmounts(text: string, fallback: Currency = "INR"): Amount[] {
  const out: Amount[] = [];
  const taken: Array<[number, number]> = [];
  const push = (value: number, currency: Currency, start: number, end: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (taken.some(([a, b]) => start < b && end > a)) return;
    taken.push([start, end]);
    out.push({ value: Math.round(value), currency, index: start });
  };

  for (let m = BEFORE.exec(text); m; m = BEFORE.exec(text)) {
    const cur = currencyOf(m[1]);
    if (!cur) continue;
    const unit = m[3];
    // Single-letter units only count when glued to the number ("₹10L", "$5M"), not "₹10 l…".
    if (unit && unit.length === 1 && /\s/.test(m[0].slice(m[0].length - 2, m[0].length - 1))) continue;
    push(toNumber(m[2]!) * scaleOf(unit), cur, m.index, m.index + m[0].length);
  }
  BEFORE.lastIndex = 0;

  for (let m = AFTER.exec(text); m; m = AFTER.exec(text)) {
    const unit = m[2];
    const cur = currencyOf(m[3]);
    // Without a currency we only trust Indian units (lakh/crore), which imply rupees.
    const indianUnit = unit && /^(lakhs?|lacs?|lac|crores?|crs?)$/i.test(unit);
    if (!cur && !indianUnit) continue;
    if (unit && unit.length === 1) continue;
    push(toNumber(m[1]!) * scaleOf(unit), cur ?? (indianUnit ? "INR" : fallback), m.index, m.index + m[0].length);
  }
  AFTER.lastIndex = 0;

  return out.sort((a, b) => a.index - b.index);
}

export interface Range {
  min: number | null;
  max: number;
  currency: Currency;
}

/**
 * Funding range implied by text. Picks the dominant currency, ignores implausible values
 * (< 1,000 or > 10,000 crore INR-equivalent) and returns min/max of what remains.
 */
export function amountRange(text: string, fallback: Currency = "INR"): Range | null {
  const amounts = findAmounts(text, fallback).filter(a => {
    const inr = a.value * FX_TO_INR[a.currency];
    return inr >= 1000 && inr <= 1e11;
  });
  if (!amounts.length) return null;
  const counts = new Map<Currency, number>();
  for (const a of amounts) counts.set(a.currency, (counts.get(a.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const values = amounts.filter(a => a.currency === currency).map(a => a.value);
  const max = Math.max(...values);
  const min = values.length > 1 ? Math.min(...values) : null;
  return { min: min === max ? null : min, max, currency };
}

export function toInr(value: number | null | undefined, currency: Currency | null | undefined): number | null {
  if (value == null || !currency) return null;
  return Math.round(value * FX_TO_INR[currency]);
}

// Sentences about the size of a whole fund or budget rather than what one applicant gets.
const AGGREGATE = /\b(corpus|outlay|allocation|allocated|total (?:budget|fund|outlay|cost)|budget of|fund size|financial year|lakh crore|turnover|revenue|valuation|raised|market size|disbursed so far|sanctioned so far)\b/i;

/** amountRange over the sentences that describe per-applicant support, ignoring fund corpus figures. */
export function applicantAmountRange(text: string, fallback: Currency = "INR"): Range | null {
  const sentences = text.split(/(?<=[.!?;])\s+|\n/).filter(s => !AGGREGATE.test(s));
  return amountRange(sentences.join(" \n "), fallback);
}
