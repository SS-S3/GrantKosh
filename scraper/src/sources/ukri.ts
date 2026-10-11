// UK Research and Innovation (incl. Innovate UK) — funding finder. Server-rendered WordPress
// listing, paginated at /opportunity/page/N/.
import * as cheerio from "cheerio";
import { programTypeOf } from "../core/classify.js";
import { parseDate } from "../core/dates.js";
import { amountRange } from "../core/money.js";
import type { RawOpportunity } from "../core/normalize.js";
import type { ProgramType } from "../core/schema.js";
import { clean } from "../core/text.js";
import type { OpportunitySource } from "./types.js";

const BASE = "https://www.ukri.org/opportunity/";
const MAX_PAGES = 60;

export function parseUkriPage(html: string): RawOpportunity[] {
  const $ = cheerio.load(html);
  const out: RawOpportunity[] = [];
  $("div.opportunity").each((_, el) => {
    const a = $(el).find(".entry-title a").first();
    const url = a.attr("href");
    const title = clean(a.text());
    if (!url || !title) return;

    const fields: Record<string, { text: string; datetime?: string }> = {};
    $(el)
      .find(".opportunity__summary .govuk-table__row")
      .each((_, row) => {
        const key = clean($(row).find("dt").text()).replace(/:$/, "").toLowerCase();
        const dd = $(row).find("dd");
        fields[key] = { text: clean(dd.text()), datetime: dd.find("time").attr("datetime") };
      });

    const summary = clean($(el).find(".entry-content").text());
    const fundingType = fields["funding type"]?.text ?? "";
    // Per-award figures beat the whole fund's size; fall back in that order.
    const money = [fields["maximum award"]?.text, fields["award range"]?.text, fields["total fund"]?.text].filter(Boolean).join(" ");
    const range =
      amountRange(fields["maximum award"]?.text ?? "", "GBP") ??
      amountRange(fields["award range"]?.text ?? "", "GBP") ??
      amountRange(fields["total fund"]?.text ?? "", "GBP") ??
      amountRange(summary, "GBP");
    const statusFlag = clean($(el).find(".opportunity-status__flag").text()).toLowerCase();
    const funders = [fields["funders"]?.text, fields["co-funders"]?.text].filter(Boolean).join("; ");

    out.push({
      nativeId: new URL(url).pathname.split("/").filter(Boolean).pop()!,
      title,
      provider: funders || "UK Research and Innovation",
      summary,
      url,
      programType: ukriType(fundingType, `${title} ${summary}`),
      amountMin: range?.min ?? null,
      amountMax: range?.max ?? null,
      currency: range?.currency ?? null,
      opensAt: parseDate(fields["opening date"]?.datetime ?? fields["opening date"]?.text),
      deadline: parseDate(fields["closing date"]?.datetime ?? fields["closing date"]?.text),
      rolling: /open[- ]ended|no closing date/i.test(fields["closing date"]?.text ?? ""),
      statusHint: statusFlag === "open" ? "open" : statusFlag === "upcoming" ? "upcoming" : statusFlag === "closed" ? "closed" : null,
      country: "GB",
      tags: [fundingType].filter(Boolean),
      confidence: "high",
      classifyText: money,
    });
  });
  return out;
}

function ukriType(fundingType: string, text: string): ProgramType {
  const f = fundingType.toLowerCase();
  if (/fellowship|studentship/.test(f)) return "fellowship";
  if (/loan/.test(f)) return "loan";
  if (/award|prize/.test(f)) return "award";
  if (/investment|equity/.test(f)) return "equity";
  const guess = programTypeOf(text, "grant");
  return guess === "scheme" || guess === "other" ? "grant" : guess;
}

export const ukri: OpportunitySource = {
  id: "ukri",
  name: "UKRI funding finder",
  kind: "opportunities",
  homepage: BASE,
  description: "Open and upcoming UK Research and Innovation and Innovate UK funding opportunities.",
  async run(ctx) {
    const out: RawOpportunity[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? BASE : `${BASE}page/${page}/`;
      const res = await ctx.http.getText(url, { acceptStatus: [404] });
      if (res.status === 404) break;
      const items = parseUkriPage(res.text);
      if (!items.length) break;
      out.push(...items);
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    if (!out.length) throw new Error("UKRI listing parsed to zero opportunities — page layout may have changed");
    return out;
  },
};
