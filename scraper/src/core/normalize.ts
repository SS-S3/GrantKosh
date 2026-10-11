// Turns an adapter's partial record into a full canonical record, inferring whatever the
// source didn't state (sectors, founder types, funding type, status…) from its text.
import {
  entitiesOf, equityFreeOf, foundersOf, fundingTypeOf, programTypeOf, registrationsOf, rollingOf, sectorsOf, stagesOf,
} from "./classify.js";
import { type Currency, toInr } from "./money.js";
import type { Country, FundingType, InvestorInput, OpportunityInput, ProgramType, Status } from "./schema.js";
import { clean, truncate, uniq } from "./text.js";

export interface RawOpportunity {
  /** Stable id inside the source (slug, numeric id, URL path…). */
  nativeId: string;
  title: string;
  provider?: string | null;
  summary?: string | null;
  url: string;
  applyUrl?: string | null;
  programType?: ProgramType;
  fundingType?: FundingType;
  equityFree?: boolean | null;
  amountMin?: number | null;
  amountMax?: number | null;
  currency?: Currency | null;
  opensAt?: string | null;
  deadline?: string | null;
  rolling?: boolean;
  /** What the source itself says ("Closed", "Open"…). Dates win over this when present. */
  statusHint?: Status | null;
  country: Country;
  states?: string[];
  sectors?: string[];
  stages?: OpportunityInput["stages"];
  founderTypes?: OpportunityInput["founderTypes"];
  registrations?: OpportunityInput["registrations"];
  entityTypes?: OpportunityInput["entityTypes"];
  eligibility?: string[];
  tags?: string[];
  cadence?: string | null;
  verified?: boolean;
  lastVerified?: string | null;
  confidence?: "high" | "medium" | "low";
  /** Extra text (eligibility, page body…) used only for tagging, never published. */
  classifyText?: string;
}

/** Optional links that don't parse are dropped instead of failing the whole record. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export function safeId(s: string): string {
  return s.replace(/[^A-Za-z0-9._~-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "x";
}

export function computeStatus(
  r: { opensAt?: string | null; deadline?: string | null; rolling?: boolean; statusHint?: Status | null },
  today: string,
): Status {
  if (r.deadline) {
    if (r.deadline < today) return "closed";
    if (r.opensAt && r.opensAt > today) return "upcoming";
    return "open";
  }
  if (r.opensAt && r.opensAt > today) return "upcoming";
  if (r.statusHint && r.statusHint !== "unknown") return r.statusHint;
  if (r.rolling) return "rolling";
  return "unknown";
}

export function normalizeOpportunity(source: string, raw: RawOpportunity, today: string): OpportunityInput {
  const title = truncate(clean(raw.title), 280);
  const summary = truncate(clean(raw.summary), 600);
  // "primary" is what the program says about itself up front; "text" adds deep page text.
  // Audience and sector tags come from primary only, so a passing mention deep in a long
  // description ("…including women and students…") doesn't mislabel the whole program.
  const primary = [title, raw.provider, summary, raw.cadence, ...(raw.eligibility ?? []), ...(raw.tags ?? [])].filter(Boolean).join(" \n ");
  const text = [primary, raw.classifyText].filter(Boolean).join(" \n ");
  const inferredSectors = sectorsOf(primary);
  // SC/ST is an Indian reservation category; "tribal" in a US/EU text means something else.
  const founders = (raw.founderTypes?.length ? raw.founderTypes : foundersOf(primary)).filter(f => raw.country === "IN" || f !== "sc-st");

  const programType = raw.programType ?? programTypeOf(`${title} ${summary}`, "other");
  const fundingType = raw.fundingType ?? fundingTypeOf(text, programType);
  const rolling = raw.rolling ?? (!raw.deadline && rollingOf(text));
  const currency = raw.amountMax != null ? (raw.currency ?? "INR") : null;

  return {
    id: `${source}:${safeId(raw.nativeId)}`,
    source,
    title,
    provider: truncate(clean(raw.provider), 200),
    summary,
    url: raw.url,
    applyUrl: raw.applyUrl && raw.applyUrl !== raw.url && isHttpUrl(raw.applyUrl) ? raw.applyUrl : null,
    programType,
    fundingType,
    equityFree: raw.equityFree ?? equityFreeOf(fundingType, text),
    amountMin: raw.amountMin ?? null,
    amountMax: raw.amountMax ?? null,
    currency,
    amountMaxInr: toInr(raw.amountMax, currency),
    opensAt: raw.opensAt ?? null,
    deadline: raw.deadline ?? null,
    rolling,
    status: computeStatus({ ...raw, rolling }, today),
    country: raw.country,
    states: uniq(raw.states ?? (raw.country === "IN" ? ["pan-india"] : [])),
    sectors: uniq(raw.sectors?.length ? raw.sectors : inferredSectors.length ? inferredSectors : sectorsOf(text.slice(0, 3000))),
    stages: uniq(raw.stages?.length ? raw.stages : stagesOf(text.slice(0, 4000))),
    founderTypes: uniq(founders),
    registrations: uniq(raw.registrations?.length ? raw.registrations : registrationsOf(text)),
    entityTypes: uniq(raw.entityTypes?.length ? raw.entityTypes : entitiesOf(text)),
    eligibility: (raw.eligibility ?? []).map(clean).filter(Boolean).slice(0, 12),
    tags: uniq((raw.tags ?? []).map(t => clean(t).toLowerCase()).filter(Boolean)).slice(0, 12),
    cadence: raw.cadence ? clean(raw.cadence) : null,
    verified: raw.verified ?? false,
    lastVerified: raw.lastVerified ?? null,
    confidence: raw.confidence ?? "medium",
    firstSeen: today,
    lastSeen: today,
  };
}

export type RawInvestor = Omit<InvestorInput, "id" | "source" | "firstSeen" | "lastSeen"> & { nativeId: string };

export function normalizeInvestor(source: string, raw: RawInvestor, today: string): InvestorInput {
  const { nativeId, ...rest } = raw;
  return { ...rest, name: clean(rest.name), id: `${source}:${safeId(nativeId)}`, source, firstSeen: today, lastSeen: today };
}
