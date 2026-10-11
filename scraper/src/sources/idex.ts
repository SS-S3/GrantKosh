// iDEX (Innovations for Defence Excellence, Ministry of Defence) — challenge editions such as
// DISC, ADITI, iDEX PRIME and DRISHTI. Listing cards link to a detail page per edition.
import * as cheerio from "cheerio";
import { parseDate } from "../core/dates.js";
import { amountRange } from "../core/money.js";
import type { RawOpportunity } from "../core/normalize.js";
import { absoluteUrl, clean, fixShouting, htmlLines, stripTrailingEllipsis, truncate, uniq } from "../core/text.js";
import { sectorsOf } from "../core/classify.js";
import type { OpportunitySource } from "./types.js";

const LIST_URL = "https://idex.gov.in/challenges";

export interface IdexCard {
  id: string;
  title: string;
  url: string;
  teaser: string;
  deadline: string | null;
  closed: boolean;
}

export function parseIdexList(html: string): IdexCard[] {
  const $ = cheerio.load(html);
  const out: IdexCard[] = [];
  $(".blog-card").each((_, card) => {
    const a = $(card).find(".blog-card__title a").first();
    const href = a.attr("href");
    const title = fixShouting(clean(a.text()));
    if (!href || !title) return;
    const url = absoluteUrl(href, LIST_URL);
    const id = url.match(/disc-category\/(\d+)/)?.[1] ?? url.split("/").filter(Boolean).pop()!;
    const meta = clean($(card).find(".blog-card__meta").text());
    out.push({
      id,
      title,
      url,
      teaser: stripTrailingEllipsis(clean($(card).find(".blog-card__text").text())),
      deadline: parseDate(meta.replace(/last date\s*-?/i, "")),
      closed: /closed/i.test(clean($(card).find(".blog-card__link").text())),
    });
  });
  // The page repeats some cards in carousels; keep the first of each id.
  return [...new Map(out.map(c => [c.id, c])).values()];
}

export function parseIdexDetail(html: string, title: string): { summary: string; grantText: string; fullText: string; problemStatements: number } {
  const lines = htmlLines(html, "script,style,noscript,header,footer,nav");
  const start = Math.max(0, lines.findIndex(l => l === title));
  const summary = lines.slice(start).find(l => l.length > 80) ?? "";
  const g = lines.findIndex(l => /^grants? up ?to$/i.test(l));
  const grantText = g >= 0 ? (lines[g + 1] ?? "") : "";
  const problemStatements = lines.filter(l => /^challenge \d+$/i.test(l)).length;
  return { summary: truncate(summary, 600), grantText, fullText: lines.slice(start, start + 200).join(" \n "), problemStatements };
}

export const idex: OpportunitySource = {
  id: "idex",
  name: "iDEX defence challenges",
  kind: "opportunities",
  homepage: LIST_URL,
  description: "Ministry of Defence innovation challenges (DISC, ADITI, iDEX PRIME, DRISHTI) with grants for startups and MSMEs.",
  async run(ctx) {
    let cards = parseIdexList((await ctx.http.getText(LIST_URL)).text);
    if (!cards.length) throw new Error("iDEX listing parsed to zero cards — page layout may have changed");
    if (ctx.limit) cards = cards.slice(0, ctx.limit);

    const out: RawOpportunity[] = [];
    for (const c of cards) {
      let d = { summary: "", grantText: "", fullText: "", problemStatements: 0 };
      try {
        d = parseIdexDetail((await ctx.http.getText(c.url)).text, c.title);
      } catch (err) {
        ctx.log.warn(`detail failed for ${c.url}: ${(err as Error).message}`);
      }
      const range = amountRange(d.grantText) ?? amountRange(`${c.teaser} ${d.summary}`);
      out.push({
        nativeId: c.id,
        title: `iDEX ${c.title}`.replace(/^iDEX (iDEX)/i, "$1"),
        provider: "iDEX-DIO, Ministry of Defence",
        summary: d.summary || c.teaser,
        url: c.url,
        programType: "challenge",
        fundingType: "grant",
        equityFree: true,
        amountMax: range?.max ?? null,
        currency: range?.currency ?? null,
        deadline: c.deadline,
        statusHint: c.closed ? "closed" : "open",
        country: "IN",
        states: ["pan-india"],
        sectors: uniq(["defence", ...sectorsOf(d.fullText || c.teaser)]),
        eligibility: d.problemStatements ? [`${d.problemStatements} problem statements published with this edition`] : [],
        confidence: "high",
        classifyText: d.fullText,
      });
    }
    return out;
  },
};
