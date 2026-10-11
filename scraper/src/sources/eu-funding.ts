// EU Funding & Tenders Portal — open and forthcoming grant topics (Horizon Europe, EIC, Digital
// Europe, LIFE, ERC…) plus cascade-funding open calls run by EU-funded projects, which are often
// the most startup-friendly (small, fast, equity-free). Uses the portal's public search API.
import { programTypeOf } from "../core/classify.js";
import { addDays, parseDate } from "../core/dates.js";
import { amountRange } from "../core/money.js";
import type { RawOpportunity } from "../core/normalize.js";
import type { ProgramType } from "../core/schema.js";
import { clean, stripHtml, truncate, uniq } from "../core/text.js";
import type { OpportunitySource } from "./types.js";

const API = "https://api.tech.ec.europa.eu/search-api/prod/rest/search";
const PAGE_SIZE = 100;
const STALE_AFTER_DAYS = 60;
const STATUS = { forthcoming: "31094501", open: "31094502" } as const;
const TYPES = { topic: "1", topic2: "2", cascade: "8" } as const;

type Meta = Record<string, string[] | undefined>;

export interface EuResult {
  url: string;
  summary?: string;
  metadata: Meta;
}

interface EuResponse {
  totalResults: number;
  results: EuResult[];
}

const first = (m: Meta, k: string) => m[k]?.[0] ?? "";

/** Pick the next upcoming cut-off for multi-deadline calls, else the latest one. */
export function pickDeadline(values: string[] | undefined, today: string): string | null {
  const dates = (values ?? []).map(v => parseDate(v)).filter((d): d is string => !!d).sort();
  if (!dates.length) return null;
  return dates.find(d => d >= today) ?? dates[dates.length - 1]!;
}

/** Largest per-grant EU contribution stated in a topic's budget overview. */
export function maxContribution(budgetOverview: string | undefined): number | null {
  if (!budgetOverview) return null;
  try {
    const data = JSON.parse(budgetOverview) as { budgetTopicActionMap?: Record<string, Array<{ maxContribution?: number }>> };
    const values = Object.values(data.budgetTopicActionMap ?? {})
      .flat()
      .map(a => Number(a.maxContribution))
      .filter(n => Number.isFinite(n) && n > 0);
    return values.length ? Math.max(...values) : null;
  } catch {
    return null;
  }
}

function euType(text: string, cascade: boolean): ProgramType {
  if (/\bprize\b/i.test(text)) return "award";
  if (/\bMSCA\b|fellowship|postdoctoral/i.test(text)) return "fellowship";
  if (/\bEIC Accelerator\b/i.test(text)) return "accelerator";
  if (cascade) return programTypeOf(text, "grant") === "accelerator" ? "accelerator" : "grant";
  const t = programTypeOf(text, "grant");
  return t === "scheme" || t === "other" || t === "csr" ? "grant" : t;
}

export function mapEuResult(r: EuResult, today: string): RawOpportunity | null {
  const m = r.metadata;
  const type = first(m, "type");
  const cascade = type === TYPES.cascade;
  const identifier = first(m, "identifier");
  const title = clean(cascade ? first(m, "callTitle") || first(m, "caName") || r.summary : first(m, "title") || r.summary);
  if (!title) return null;

  const description = stripHtml(cascade ? first(m, "description") || first(m, "destinationDetails") || first(m, "furtherInformation") : first(m, "descriptionByte"))
    .replace(/^(Expected Outcome|Scope|Objectives?):\s*/i, "");
  const actions = m["typesOfAction"] ?? [];
  const status = first(m, "status");

  let amountMax: number | null;
  let amountMin: number | null = null;
  if (cascade) {
    // Cascade calls publish the whole call budget; the per-applicant cap is usually in the text.
    const range = amountRange(description, "EUR");
    amountMax = range?.max ?? null;
    amountMin = range?.min ?? null;
  } else {
    amountMax = maxContribution(first(m, "budgetOverview"));
  }

  const project = clean(first(m, "projectName"));
  const nativeId = first(m, "ccm2Id") || identifier || r.url.split("/").pop()!;
  return {
    nativeId,
    title,
    provider: cascade ? `${project || "EU-funded project"} (EU cascade funding)` : uniq(["European Commission", ...actions]).join(" · "),
    summary: truncate(description, 600),
    url: first(m, "url") || r.url,
    programType: euType(`${title} ${actions.join(" ")} ${description.slice(0, 400)}`, cascade),
    amountMax,
    amountMin,
    currency: amountMax != null ? "EUR" : null,
    opensAt: parseDate(first(m, "startDate")),
    deadline: pickDeadline(m["deadlineDate"], today),
    statusHint: status === STATUS.open ? "open" : status === STATUS.forthcoming ? "upcoming" : null,
    country: "EU",
    tags: uniq([...(m["tags"] ?? []), ...actions, cascade ? "cascade funding" : "", identifier].filter(Boolean)),
    cadence: first(m, "deadlineModel") || null,
    confidence: "high",
    classifyText: description.slice(0, 4000),
  };
}

export const euFunding: OpportunitySource = {
  id: "eu-funding",
  name: "EU Funding & Tenders Portal",
  kind: "opportunities",
  homepage: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals",
  description: "Open and forthcoming EU grant topics (Horizon Europe, EIC, Digital Europe…) and cascade-funding open calls.",
  async run(ctx) {
    const query = { bool: { must: [{ terms: { type: Object.values(TYPES) } }, { terms: { status: Object.values(STATUS) } }] } };
    const byId = new Map<string, RawOpportunity>();
    let stale = 0;
    for (let page = 1; page <= 50; page++) {
      const form = new FormData();
      form.append("query", new Blob([JSON.stringify(query)], { type: "application/json" }));
      form.append("languages", new Blob([JSON.stringify(["en"])], { type: "application/json" }));
      form.append("sort", new Blob([JSON.stringify({ field: "startDate", order: "DESC" })], { type: "application/json" }));
      const res = await ctx.http.request(`${API}?apiKey=SEDIA&text=***&pageSize=${PAGE_SIZE}&pageNumber=${page}`, {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
        // FormData bodies aren't part of the cache key; caching would serve page 1 for every page.
        noCache: true,
      });
      const data = JSON.parse(res.text) as EuResponse;
      for (const r of data.results) {
        if (first(r.metadata, "language") && first(r.metadata, "language") !== "en") continue;
        const mapped = mapEuResult(r, ctx.today);
        // The API keeps some long-finished topics flagged "open"; drop those whose last cut-off is well past.
        if (mapped?.deadline && mapped.deadline < addDays(ctx.today, -STALE_AFTER_DAYS)) {
          stale++;
          continue;
        }
        if (mapped && !byId.has(mapped.nativeId)) byId.set(mapped.nativeId, mapped);
      }
      if (!data.results.length || page * PAGE_SIZE >= data.totalResults) break;
      if (ctx.limit && byId.size >= ctx.limit) break;
    }
    if (stale) ctx.log.info(`dropped ${stale} topics still flagged open whose deadline passed over ${STALE_AFTER_DAYS} days ago`);
    return [...byId.values()];
  },
};
