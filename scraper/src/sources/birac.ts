// BIRAC (Biotechnology Industry Research Assistance Council, DBT) — calls for proposals.
// The listing page has a "current" and a "previous" table; each call links to a detail page.
import * as cheerio from "cheerio";
import { sectorsOf } from "../core/classify.js";
import { addDays, parseDate } from "../core/dates.js";
import { amountRange } from "../core/money.js";
import type { RawOpportunity } from "../core/normalize.js";
import { absoluteUrl, clean, fixShouting, stripTrailingEllipsis, truncate, uniq } from "../core/text.js";
import type { OpportunitySource } from "./types.js";

const LIST_URL = "https://birac.nic.in/cfp.php";
/** How far back to keep closed calls (they show cadence: most BIRAC schemes reopen yearly). */
const KEEP_CLOSED_DAYS = 400;

export interface BiracListing {
  id: string;
  title: string;
  url: string;
  opensAt: string | null;
  deadline: string | null;
  current: boolean;
}

export function parseBiracList(html: string): BiracListing[] {
  const $ = cheerio.load(html);
  const out: BiracListing[] = [];
  for (const table of ["#current", "#previous"]) {
    $(`${table} tbody tr`).each((_, tr) => {
      const a = $(tr).find("a[href*='cfp_view']").first();
      const href = a.attr("href");
      if (!href) return;
      const url = absoluteUrl(href, LIST_URL);
      const id = new URL(url).searchParams.get("id");
      if (!id) return;
      const opens = clean($(tr).find("small.text-green").text());
      const last = clean($(tr).find("small.text-red").text());
      out.push({
        id,
        title: cleanTitle(a.text()),
        url,
        opensAt: parseDate(opens.replace(/^opens on/i, "")),
        deadline: parseDate(last.replace(/^last date of submission/i, "")),
        current: table === "#current",
      });
    });
  }
  return out;
}

/** BIRAC titles are shouty and often embed the deadline; trim that noise. */
function cleanTitle(raw: string): string {
  let t = stripTrailingEllipsis(clean(raw));
  t = t.replace(/\s*[-–,]?\s*last date (?:to apply|of submission|for submission)?\s*[-–:]?.*$/i, "");
  t = t.replace(/^birac\s+(announces|invites)\s+/i, "");
  return fixShouting(t).replace(/^./, c => c.toUpperCase());
}

export interface BiracDetail {
  summary: string;
  fullText: string;
}

export function parseBiracDetail(html: string): BiracDetail {
  const $ = cheerio.load(html);
  const panels = $(".panel .panel-body")
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  return { summary: truncate(panels[0] ?? "", 600), fullText: panels.join(" \n ") };
}

export const birac: OpportunitySource = {
  id: "birac",
  name: "BIRAC calls for proposals",
  kind: "opportunities",
  homepage: LIST_URL,
  description: "Biotech and life-science grant calls from BIRAC, Department of Biotechnology (BIG, SBIRI, BIPP, E-YUVA, Grand Challenges…).",
  async run(ctx) {
    const res = await ctx.http.getText(LIST_URL);
    const cutoff = addDays(ctx.today, -KEEP_CLOSED_DAYS);
    let rows = parseBiracList(res.text).filter(r => r.current || (r.deadline ?? "0000") >= cutoff);
    if (!rows.length) throw new Error("BIRAC listing parsed to zero rows — page layout may have changed");
    if (ctx.limit) rows = rows.slice(0, ctx.limit);

    const out: RawOpportunity[] = [];
    for (const row of rows) {
      let detail: BiracDetail = { summary: "", fullText: "" };
      try {
        detail = parseBiracDetail((await ctx.http.getText(row.url)).text);
      } catch (err) {
        ctx.log.warn(`detail failed for ${row.url}: ${(err as Error).message}`);
      }
      const range = amountRange(detail.fullText);
      out.push({
        nativeId: row.id,
        title: row.title,
        provider: "BIRAC, Department of Biotechnology",
        summary: detail.summary,
        url: row.url,
        opensAt: row.opensAt,
        deadline: row.deadline,
        statusHint: row.current ? "open" : "closed",
        amountMax: range?.max ?? null,
        amountMin: range?.min ?? null,
        currency: range?.currency ?? null,
        country: "IN",
        states: ["pan-india"],
        sectors: uniq(["biotech", ...sectorsOf(row.title)]),
        confidence: "high",
        classifyText: detail.fullText.slice(0, 6000),
      });
    }
    return out;
  },
};
