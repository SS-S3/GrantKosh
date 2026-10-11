// myScheme (myscheme.gov.in) — the Government of India's national scheme catalogue, covering
// central and state schemes. We read its public search API (the same one the website calls,
// with the key the website ships to every visitor) and keep the categories relevant to founders.
import { stateSlug } from "../core/classify.js";
import { applicantAmountRange } from "../core/money.js";
import type { RawOpportunity } from "../core/normalize.js";
import type { ProgramType } from "../core/schema.js";
import { clean, uniq } from "../core/text.js";
import type { OpportunitySource } from "./types.js";

const API = "https://api.myscheme.gov.in/search/v6/schemes";
const PUBLIC_KEY = process.env.MYSCHEME_API_KEY || "tYTy5eEhlu9rFjyxuCr7ra7ACp4dv1RH8gWuHTDc";
const PAGE = 100;

interface Category {
  name: string;
  /** Optional filter for broad categories: keep only items whose tags/description match. */
  keep?: RegExp;
}

const CATEGORIES: Category[] = [
  { name: "Business & Entrepreneurship" },
  { name: "Science, IT & Communications" },
  { name: "Banking,Financial Services and Insurance", keep: /\b(loan|entrepreneur\w*|business|enterprise|msme|startup|self-employment|industry|investment|venture|subsidy|incentive)\b/i },
  { name: "Agriculture,Rural & Environment", keep: /\b(entrepreneur\w*|enterprise|startup|agri-?business|fpo|producer organi[sz]ation|processing unit|agri-?preneur|agri-?clinic|venture)\b/i },
  { name: "Skills & Employment", keep: /\b(entrepreneur\w*|self-employment|startup|enterprise|setting up (?:a |an )?(?:business|unit|venture))\b/i },
  { name: "Women and Child", keep: /\b(entrepreneur\w*|enterprise|startup|self-employment|business)\b/i },
];

export interface MySchemeHit {
  id: string;
  fields: {
    schemeName: string;
    schemeShortTitle?: string;
    slug: string;
    briefDescription?: string;
    nodalMinistryName?: string;
    level?: string;
    beneficiaryState?: string[];
    schemeCategory?: string[];
    schemeCloseDate?: string | null;
    tags?: string[];
  };
}

interface SearchResponse {
  statusCode: number;
  data: { hits: { items: MySchemeHit[]; page: { total: number; totalPages: number } } };
}

const TAG_TYPE: Array<[RegExp, ProgramType]> = [
  [/^(loan|education loan|credit|interest subvention)$/i, "loan"],
  [/^(subsidy|capital subsidy|interest subsidy|incentive|reimbursement)$/i, "subsidy"],
  [/^(grant|grant-in-aid|seed fund(ing)?)$/i, "grant"],
  [/^(fellowship|scholarship)$/i, "fellowship"],
  [/^(award|prize)$/i, "award"],
  [/^(incubation|incubator)$/i, "incubation"],
  [/^(venture capital|equity)$/i, "equity"],
];

export function mapMySchemeHit(hit: MySchemeHit): RawOpportunity {
  const f = hit.fields;
  const tags = f.tags ?? [];
  const brief = clean(f.briefDescription);
  const states = uniq((f.beneficiaryState ?? []).map(stateSlug).filter((s): s is string => !!s));
  const range = applicantAmountRange(brief);
  let programType: ProgramType = "scheme";
  for (const t of tags) {
    const hitType = TAG_TYPE.find(([re]) => re.test(t.trim()));
    if (hitType) {
      programType = hitType[1];
      break;
    }
  }
  const stateName = f.level === "State" && f.beneficiaryState?.[0] && f.beneficiaryState[0] !== "All" ? `Government of ${f.beneficiaryState[0]}` : "";
  return {
    nativeId: f.slug,
    title: f.schemeShortTitle && !f.schemeName.includes(f.schemeShortTitle) ? `${f.schemeName} (${f.schemeShortTitle})` : f.schemeName,
    provider: f.nodalMinistryName || stateName || (f.level === "Central" ? "Government of India" : ""),
    summary: brief,
    url: `https://www.myscheme.gov.in/schemes/${encodeURIComponent(f.slug)}`,
    programType,
    amountMin: range?.min ?? null,
    amountMax: range?.max ?? null,
    currency: range?.currency ?? null,
    deadline: f.schemeCloseDate || null,
    // Government schemes without a close date run continuously until withdrawn.
    rolling: !f.schemeCloseDate,
    country: "IN",
    states: states.length ? states : ["pan-india"],
    tags: [...tags, ...(f.schemeCategory ?? []), f.level ?? ""].filter(Boolean),
    confidence: "medium",
    classifyText: tags.join(" "),
  };
}

export const myscheme: OpportunitySource = {
  id: "myscheme",
  name: "myScheme (Govt. of India)",
  kind: "opportunities",
  homepage: "https://www.myscheme.gov.in/",
  description: "National catalogue of central and state government schemes: business, entrepreneurship, science/IT, and founder-relevant finance, agriculture, skills and women's schemes.",
  async run(ctx) {
    const seen = new Map<string, RawOpportunity>();
    for (const cat of CATEGORIES) {
      const q = encodeURIComponent(JSON.stringify([{ identifier: "schemeCategory", value: cat.name }]));
      let kept = 0;
      for (let from = 0; ; from += PAGE) {
        const url = `${API}?lang=en&q=${q}&keyword=&sort=&from=${from}&size=${PAGE}`;
        const res = await ctx.http.getJson<SearchResponse>(url, { headers: { "x-api-key": PUBLIC_KEY, Origin: "https://www.myscheme.gov.in" } });
        if (res.statusCode !== 200) throw new Error(`myScheme API returned statusCode ${res.statusCode}`);
        const { items, page } = res.data.hits;
        for (const hit of items) {
          if (seen.has(hit.fields.slug)) continue;
          if (cat.keep && !cat.keep.test(`${(hit.fields.tags ?? []).join(" ")} ${hit.fields.briefDescription ?? ""} ${hit.fields.schemeName}`)) continue;
          seen.set(hit.fields.slug, mapMySchemeHit(hit));
          kept++;
        }
        if (from + PAGE >= page.total || !items.length) break;
        if (ctx.limit && seen.size >= ctx.limit) break;
      }
      ctx.log.info(`${cat.name}: kept ${kept}`);
      if (ctx.limit && seen.size >= ctx.limit) break;
    }
    return [...seen.values()];
  },
};
