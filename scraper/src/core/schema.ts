// Canonical data model. Every adapter's output is validated against these schemas before it
// reaches the published JSON, and the web app imports the inferred types.
import { z } from "zod";

// Filter vocabularies. They follow the facets founders actually filter by:
// stage, program type, funding type, deadline, industry, state, founder type,
// registrations and entity type.
export const PROGRAM_TYPES = ["grant", "scheme", "challenge", "accelerator", "incubation", "fellowship", "loan", "subsidy", "equity", "award", "csr", "other"] as const;
export const FUNDING_TYPES = ["grant", "equity", "debt", "subsidy", "prize", "in-kind", "mixed", "unknown"] as const;
export const STAGES = ["idea", "prototype", "early-revenue", "growth"] as const;
export const FOUNDER_TYPES = ["women", "sc-st", "student", "researcher", "msme", "minority", "divyang", "rural", "youth"] as const;
export const REGISTRATIONS = ["dpiit", "udyam", "incubated", "gst"] as const;
export const ENTITY_TYPES = ["private-limited", "llp", "partnership", "proprietorship", "individual", "ngo", "academic", "cooperative", "fpo"] as const;
export const STATUSES = ["open", "upcoming", "rolling", "closed", "unknown"] as const;
export const COUNTRIES = ["IN", "US", "GB", "EU", "INT"] as const;
export const CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export const INVESTOR_KINDS = ["angel-fund", "venture-capital", "private-equity", "venture-debt", "hedge", "social-impact", "infrastructure", "sme", "fund-of-funds", "other"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const httpsUrl = z.string().url().refine(u => /^https?:\/\//.test(u), "expected http(s) URL");

export const OpportunitySchema = z.object({
  /** `${source}:${native id}` — stable across runs. */
  id: z.string().min(3).regex(/^[a-z0-9-]+:[A-Za-z0-9._~-]+$/),
  source: z.string(),
  /** Other sources that list the same program (filled in by dedupe). */
  alsoListedOn: z.array(z.string()).default([]),
  title: z.string().min(3).max(300),
  provider: z.string().max(200).default(""),
  summary: z.string().max(700).default(""),
  /** Official page for the program. */
  url: httpsUrl,
  /** Official application link, when it differs from `url`. */
  applyUrl: httpsUrl.nullable().default(null),

  programType: z.enum(PROGRAM_TYPES),
  fundingType: z.enum(FUNDING_TYPES),
  /** True when the money does not take equity; null when unknown. */
  equityFree: z.boolean().nullable().default(null),
  amountMin: z.number().nonnegative().nullable().default(null),
  amountMax: z.number().nonnegative().nullable().default(null),
  currency: z.enum(CURRENCIES).nullable().default(null),
  /** amountMax converted to INR at approximate rates; for sorting/filtering only. */
  amountMaxInr: z.number().nonnegative().nullable().default(null),

  opensAt: isoDate.nullable().default(null),
  deadline: isoDate.nullable().default(null),
  /** Rolling / always-open intake. */
  rolling: z.boolean().default(false),
  status: z.enum(STATUSES),

  country: z.enum(COUNTRIES),
  /** Indian state slugs, or "pan-india". Empty for non-Indian programs. */
  states: z.array(z.string()).default([]),
  sectors: z.array(z.string()).default([]),
  stages: z.array(z.enum(STAGES)).default([]),
  founderTypes: z.array(z.enum(FOUNDER_TYPES)).default([]),
  registrations: z.array(z.enum(REGISTRATIONS)).default([]),
  entityTypes: z.array(z.enum(ENTITY_TYPES)).default([]),
  eligibility: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  cadence: z.string().nullable().default(null),

  /** A human checked this record against the official source. */
  verified: z.boolean().default(false),
  lastVerified: isoDate.nullable().default(null),
  /** How much of the record came from structured data vs. text heuristics. */
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  firstSeen: isoDate,
  lastSeen: isoDate,
});

export const InvestorSchema = z.object({
  id: z.string().min(3).regex(/^[a-z0-9-]+:[A-Za-z0-9._~-]+$/),
  source: z.string(),
  name: z.string().min(2).max(200),
  kind: z.enum(INVESTOR_KINDS),
  /** Regulatory category, e.g. "AIF Category I". */
  category: z.string().nullable().default(null),
  registrationNo: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  website: httpsUrl.nullable().default(null),
  city: z.string().nullable().default(null),
  state: z.string().nullable().default(null),
  country: z.enum(COUNTRIES),
  registeredOn: isoDate.nullable().default(null),
  validUntil: isoDate.nullable().default(null),
  /** Page where the record was found. */
  sourceUrl: httpsUrl,
  tags: z.array(z.string()).default([]),
  firstSeen: isoDate,
  lastSeen: isoDate,
});

export type Opportunity = z.infer<typeof OpportunitySchema>;
export type OpportunityInput = z.input<typeof OpportunitySchema>;
export type Investor = z.infer<typeof InvestorSchema>;
export type InvestorInput = z.input<typeof InvestorSchema>;
export type ProgramType = (typeof PROGRAM_TYPES)[number];
export type FundingType = (typeof FUNDING_TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type Country = (typeof COUNTRIES)[number];
export type InvestorKind = (typeof INVESTOR_KINDS)[number];

export interface SourceMeta {
  id: string;
  name: string;
  kind: "opportunities" | "investors";
  homepage: string;
  description: string;
  ok: boolean;
  /** True when this run failed and the previous run's records were kept. */
  stale: boolean;
  count: number;
  rejected: number;
  durationMs: number;
  error: string | null;
  lastSuccess: string | null;
}

export interface DatasetMeta {
  generatedAt: string;
  opportunities: number;
  investors: number;
  sources: SourceMeta[];
  fxToInr: Record<string, number>;
}
