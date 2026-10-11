// Grants.gov — every posted and forecasted US federal grant (incl. SBIR/STTR). Uses the public
// search2 + fetchOpportunity REST API (no key required).
import { parseDate } from "../core/dates.js";
import type { RawOpportunity } from "../core/normalize.js";
import { pool } from "../core/pool.js";
import type { ProgramType } from "../core/schema.js";
import { clean, stripHtml, truncate, uniq } from "../core/text.js";
import type { OpportunitySource } from "./types.js";

const SEARCH = "https://api.grants.gov/v1/api/search2";
const DETAIL = "https://api.grants.gov/v1/api/fetchOpportunity";
const ROWS = 250;

export interface GrantsGovHit {
  id: string;
  number: string;
  title: string;
  agency?: string;
  agencyCode?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus: "posted" | "forecasted" | string;
  docType?: string;
}

interface SearchResponse {
  errorcode: number;
  data: { hitCount: number; oppHits: GrantsGovHit[] };
}

interface Coded {
  id: string;
  description: string;
}

interface DetailBody {
  synopsisDesc?: string;
  forecastDesc?: string;
  awardCeiling?: string;
  awardFloor?: string;
  applicantTypes?: Coded[];
  fundingInstruments?: Coded[];
  fundingActivityCategories?: Coded[];
  applicantEligibilityDesc?: string;
  fundingDescLinkUrl?: string;
  estApplicationResponseDate?: string;
}

interface DetailResponse {
  errorcode: number;
  data: { synopsis?: DetailBody; forecast?: DetailBody };
}

const money = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function grantsGovType(instruments: Coded[], title: string): ProgramType {
  const kinds = instruments.map(i => i.description.toLowerCase()).join(" ");
  if (/cooperative agreement|grant/.test(kinds)) return /\bprize|challenge\b/i.test(title) ? "challenge" : /fellowship/i.test(title) ? "fellowship" : "grant";
  if (/loan|insurance|guarantee/.test(kinds)) return "loan";
  if (/procurement contract/.test(kinds)) return "other";
  return "grant";
}

export function mapGrantsGov(hit: GrantsGovHit, detail: DetailBody | null): RawOpportunity {
  const desc = stripHtml(detail?.synopsisDesc ?? detail?.forecastDesc ?? "");
  const instruments = detail?.fundingInstruments ?? [];
  const applicants = (detail?.applicantTypes ?? []).map(a => a.description);
  const categories = (detail?.fundingActivityCategories ?? []).map(c => c.description);
  const ceiling = money(detail?.awardCeiling);
  const floor = money(detail?.awardFloor);
  const forProfit = applicants.some(a => /small business|for[- ]profit|unrestricted/i.test(a));
  return {
    nativeId: hit.id,
    title: clean(hit.title),
    provider: clean(hit.agency) || hit.agencyCode || "US federal government",
    summary: truncate(desc, 600),
    url: `https://www.grants.gov/search-results-detail/${hit.id}`,
    applyUrl: detail?.fundingDescLinkUrl?.replace(/^http:/, "https:") || null,
    programType: grantsGovType(instruments, hit.title),
    amountMax: ceiling,
    amountMin: floor && ceiling && floor < ceiling ? floor : null,
    currency: ceiling ? "USD" : null,
    opensAt: parseDate(hit.openDate, "mdy"),
    deadline: parseDate(hit.closeDate, "mdy") ?? parseDate(detail?.estApplicationResponseDate, "mdy"),
    statusHint: hit.oppStatus === "forecasted" ? "upcoming" : hit.oppStatus === "posted" ? "open" : null,
    country: "US",
    entityTypes: forProfit ? ["private-limited"] : undefined,
    tags: uniq([hit.number, ...categories, forProfit ? "for-profit eligible" : "", ...instruments.map(i => i.description)].filter(Boolean)),
    eligibility: applicants.slice(0, 8),
    confidence: detail ? "high" : "medium",
    classifyText: `${categories.join(" ")} ${clean(detail?.applicantEligibilityDesc).slice(0, 1500)} ${desc.slice(0, 3000)}`,
  };
}

export const grantsGov: OpportunitySource = {
  id: "grants-gov",
  name: "Grants.gov (US federal)",
  kind: "opportunities",
  homepage: "https://www.grants.gov/search-grants",
  description: "All posted and forecasted US federal grant opportunities, incl. SBIR/STTR small-business programs.",
  async run(ctx) {
    const hits: GrantsGovHit[] = [];
    for (let start = 0; ; start += ROWS) {
      const res = await ctx.http.postJson<SearchResponse>(SEARCH, { rows: ROWS, startRecordNum: start, oppStatuses: "forecasted|posted", sortBy: "openDate|desc" });
      if (res.errorcode !== 0) throw new Error(`grants.gov search errorcode ${res.errorcode}`);
      hits.push(...res.data.oppHits);
      if (!res.data.oppHits.length || start + ROWS >= res.data.hitCount) break;
      if (ctx.limit && hits.length >= ctx.limit) break;
    }
    const unique = [...new Map(hits.map(h => [h.id, h])).values()].slice(0, ctx.limit ?? undefined);

    let failed = 0;
    const details = await pool(
      unique,
      4,
      async h => {
        const res = await ctx.http.postJson<DetailResponse>(DETAIL, { opportunityId: Number(h.id) });
        return res.data.synopsis ?? res.data.forecast ?? null;
      },
      () => failed++,
    );
    if (failed) ctx.log.warn(`${failed}/${unique.length} detail lookups failed; those records keep list-level data only`);
    return unique.map((h, i) => mapGrantsGov(h, details[i] ?? null));
  },
};
