// SEBI register of Alternative Investment Funds — every SEBI-registered venture capital, angel,
// private equity, debt and hedge fund in India. The register is public; we keep the fund-level
// fields (name, registration, category, email, city/state) and leave out individual contact names
// and street addresses.
import * as cheerio from "cheerio";
import { INDIAN_STATES, stateSlug } from "../core/classify.js";
import { parseDate } from "../core/dates.js";
import type { RawInvestor } from "../core/normalize.js";
import type { InvestorKind } from "../core/schema.js";
import { clean } from "../core/text.js";
import type { InvestorSource } from "./types.js";

const PAGE_URL = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=16";
const AJAX_URL = "https://www.sebi.gov.in/sebiweb/ajax/other/getintmfpiinfo.jsp";
const PER_PAGE = 25;

export interface SebiCard {
  name: string;
  registrationNo: string;
  email: string;
  address: string;
  validity: string;
}

export function parseSebiPage(html: string): { cards: SebiCard[]; total: number | null } {
  const $ = cheerio.load(html);
  const total = Number(clean($(".pagination_inner p").first().text()).match(/of\s+(\d+)\s+records/i)?.[1] ?? NaN);
  const cards: SebiCard[] = [];
  $(".card-table").each((_, card) => {
    const f: Record<string, string> = {};
    $(card)
      .find(".card-view")
      .each((_, row) => {
        f[clean($(row).find(".title").text()).toLowerCase()] = clean($(row).find(".value").text());
      });
    if (!f["registration no."]) return;
    cards.push({
      name: f["name"] ?? "",
      registrationNo: f["registration no."],
      email: f["e-mail"] ?? "",
      address: f["address"] ?? f["correspondence address"] ?? "",
      validity: f["validity"] ?? "",
    });
  });
  return { cards, total: Number.isFinite(total) ? total : null };
}

const CATEGORY: Record<string, string> = { "1": "AIF Category I", "2": "AIF Category II", "3": "AIF Category III" };

export function investorKind(name: string, category: string | null): InvestorKind {
  const n = name.toLowerCase();
  if (/\bangels?\b|angel fund/.test(n)) return "angel-fund";
  if (/fund of funds|\bfof\b/.test(n)) return "fund-of-funds";
  if (/venture debt|\bcredit\b|\bdebt\b|lending|\bincome\b|\byield\b|special situations|stressed/.test(n)) return "venture-debt";
  if (/social|impact|\besg\b/.test(n)) return "social-impact";
  if (/infra/.test(n)) return "infrastructure";
  if (/\bm?smes?\b/.test(n)) return "sme";
  if (category === "AIF Category III") return "hedge";
  if (/venture|\bvc\b|seed|startup|start-up|early stage|incubat|accelerat/.test(n)) return "venture-capital";
  if (/private equity|\bpe\b|buyout|growth|opportunit/.test(n)) return "private-equity";
  if (category === "AIF Category I") return "venture-capital";
  if (category === "AIF Category II") return "private-equity";
  return "other";
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** SEBI addresses end with "…, CITY, STATE, PIN". */
export function cityState(address: string): { city: string | null; state: string | null } {
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length && /^\d{6}$/.test(parts[parts.length - 1]!.replace(/\s/g, ""))) parts.pop();
  const stateRaw = parts.pop() ?? "";
  const slug = stateSlug(stateRaw);
  if (!slug || slug === "pan-india") return { city: null, state: null };
  const city = parts.pop();
  return { city: city && city.length < 40 ? titleCase(city) : null, state: INDIAN_STATES[slug] ?? null };
}

export function mapSebiCard(card: SebiCard): RawInvestor | null {
  if (!card.name || !card.registrationNo) return null;
  const cat = card.registrationNo.match(/AIF(\d)/i)?.[1];
  const category = cat ? (CATEGORY[cat] ?? null) : null;
  const [from, to] = card.validity.split(/\s+-\s+/);
  const { city, state } = cityState(card.address);
  const email = card.email.toLowerCase();
  return {
    nativeId: card.registrationNo.replace(/\//g, "-"),
    name: card.name,
    kind: investorKind(card.name, category),
    category,
    registrationNo: card.registrationNo,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    website: null,
    city,
    state,
    country: "IN",
    registeredOn: parseDate(from),
    validUntil: to && !/perpetual/i.test(to) ? parseDate(to) : null,
    sourceUrl: PAGE_URL,
    tags: ["sebi-registered", category ?? ""].filter(Boolean),
  };
}

function form(page: number): Record<string, string> {
  return {
    nextValue: "1", next: "n", intmId: "16", contPer: "", name: "", regNo: "", email: "", location: "",
    exchange: "", affiliate: "", alp: "", language: "2", model: "", esgCategory: "", doDirect: String(page), intmIds: "",
  };
}

export const sebiAif: InvestorSource = {
  id: "sebi-aif",
  name: "SEBI registered AIFs",
  kind: "investors",
  homepage: PAGE_URL,
  description: "Every SEBI-registered Alternative Investment Fund: venture capital, angel, private equity, venture debt and other funds.",
  async run(ctx) {
    // The register's AJAX endpoint checks for a same-site Referer, as a browser would send.
    const headers = { Referer: PAGE_URL, "X-Requested-With": "XMLHttpRequest" };
    const fetchPage = async (page: number) => parseSebiPage((await ctx.http.postForm(AJAX_URL, form(page), { headers })).text);

    const firstPage = await fetchPage(0);
    if (!firstPage.total || !firstPage.cards.length) throw new Error("SEBI register returned no records — blocked or layout changed");
    const pages = Math.ceil(firstPage.total / PER_PAGE);
    const cards = [...firstPage.cards];
    for (let p = 1; p < pages; p++) {
      if (ctx.limit && cards.length >= ctx.limit) break;
      cards.push(...(await fetchPage(p)).cards);
      if (p % 20 === 0) ctx.log.info(`page ${p + 1}/${pages}`);
    }
    const byReg = new Map<string, RawInvestor>();
    for (const c of cards) {
      const inv = mapSebiCard(c);
      if (inv) byReg.set(inv.nativeId, inv);
    }
    ctx.log.info(`${byReg.size} funds (${cards.length - byReg.size} skipped: unnamed or duplicate)`);
    return [...byReg.values()];
  },
};
