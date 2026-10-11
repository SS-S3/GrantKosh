// Discovery crawl: finds programs that no structured official source covers (incubator calls,
// CSR grants, corporate accelerators, state programs, international cohorts…).
//
// How it works, and what it deliberately does NOT do:
//   1. Reads the public grants sitemap of startupgrantsindia.com (robots.txt allows crawling).
//   2. For each program page, streams only the first ~90 KB, enough for the page's schema.org
//      JSON-LD, and keeps three facts: program name, funder name and the official apply link
//      (tracking parameters removed). Nothing else from that site is stored or published:
//      no descriptions, amounts, eligibility or other editorial content.
//   3. Fetches the official link and builds the record from the program's own page
//      (its title/description, plus deadlines, amounts and tags found in its text).
//
// Both steps are incremental. A program page is re-read only when its sitemap <lastmod>
// changes, and an official page only when its cached facts are older than OFFICIAL_TTL_DAYS.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { statesOf } from "../core/classify.js";
import { addDays } from "../core/dates.js";
import { extractPage, isErrorPage, isSpam, usableDescription, type PageFacts } from "../core/extract.js";
import type { RawOpportunity } from "../core/normalize.js";
import { pool } from "../core/pool.js";
import { clean, stripTracking, uniq } from "../core/text.js";
import type { OpportunitySource, SourceContext } from "./types.js";

const SITEMAP = "https://www.startupgrantsindia.com/api/sitemap/grants";
const DISCOVERY_HOST = "www.startupgrantsindia.com";
const OFFICIAL_TTL_DAYS = 7;
const SAVE_EVERY = 100;

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

export interface DiscoveryRecord {
  lastmod: string | null;
  name: string | null;
  funder: string | null;
  officialUrl: string | null;
  checkedAt: string;
}

export interface OfficialRecord {
  fetchedAt: string;
  ok: boolean;
  error?: string;
  finalUrl?: string;
  facts?: PageFacts;
}

interface DiscoveryState {
  version: 1;
  programs: Record<string, DiscoveryRecord>;
  official: Record<string, OfficialRecord>;
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const $ = cheerio.load(xml, { xml: true });
  return $("url")
    .map((_, el) => ({ loc: clean($(el).children("loc").text()), lastmod: clean($(el).children("lastmod").text()) || null }))
    .get()
    .filter(e => e.loc && !/\/hindi\//.test(e.loc));
}

/** Pull name, funder and apply link out of a program page's MonetaryGrant JSON-LD. */
export function parseProgramLd(html: string): Pick<DiscoveryRecord, "name" | "funder" | "officialUrl"> | null {
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!m[1]!.includes("MonetaryGrant")) continue;
    try {
      const doc = JSON.parse(m[1]!);
      const nodes: any[] = Array.isArray(doc["@graph"]) ? doc["@graph"] : [doc];
      const g = nodes.find(n => n?.["@type"] === "MonetaryGrant");
      if (!g) continue;
      const target = typeof g.potentialAction?.target === "string" ? g.potentialAction.target : g.potentialAction?.target?.urlTemplate;
      const cleaned = typeof target === "string" && /^https?:\/\//.test(target) ? stripTracking(target) : null;
      // Links back into the aggregator itself are not official sources.
      const official = cleaned && !/(^|\.)startupgrantsindia\.com$/i.test(new URL(cleaned).host) ? cleaned : null;
      return { name: clean(g.name) || null, funder: clean(g.funder?.name) || null, officialUrl: official };
    } catch {
      return null;
    }
  }
  return null;
}

async function loadState(path: string): Promise<DiscoveryState> {
  try {
    const s = JSON.parse(await readFile(path, "utf8")) as DiscoveryState;
    if (s.version === 1) return s;
  } catch {
    /* first run */
  }
  return { version: 1, programs: {}, official: {} };
}

async function saveState(path: string, state: DiscoveryState) {
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, JSON.stringify({ version: 1, programs: sorted(state.programs), official: sorted(state.official) }, null, 1));
}

const SKIP_OFFICIAL = /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|$)|^https?:\/\/(?:www\.)?(?:linkedin|facebook|instagram|twitter|x|youtube|wa\.me|t\.me|whatsapp)\./i;

export function toOpportunity(slug: string, d: DiscoveryRecord, o: OfficialRecord | undefined): RawOpportunity | null {
  if (!d.name || !d.officialUrl) return null;
  // Ignore pages that turned out to be spam-injected or error/login pages; keep name + link only.
  const raw = o?.ok ? o.facts : undefined;
  const f = raw && !isSpam(`${raw.title} ${raw.description}`) ? raw : undefined;
  const host = (() => {
    try {
      return new URL(d.officialUrl!).host;
    } catch {
      return "";
    }
  })();
  const indian = /\.in$|\.gov\.in$|\.nic\.in$|\.org\.in$|\.co\.in$/.test(host) || !!f?.mentionsIndia || /india|bharat/i.test(`${d.name} ${d.funder}`);
  const states = statesOf(`${d.name} ${d.funder ?? ""}`);
  return {
    nativeId: slug,
    title: d.name,
    provider: d.funder ?? host.replace(/^www\./, ""),
    summary: usableDescription(f?.description),
    url: d.officialUrl,
    programType: f?.programType && f.programType !== "other" ? f.programType : undefined,
    amountMax: f?.amount?.max ?? null,
    amountMin: f?.amount?.min ?? null,
    currency: f?.amount?.currency ?? null,
    deadline: f?.deadline ?? null,
    opensAt: f?.opensAt ?? null,
    rolling: f?.rolling ?? false,
    country: indian ? "IN" : "INT",
    states: indian ? (states.length ? states : ["pan-india"]) : [],
    sectors: f?.sectors,
    stages: f?.stages as RawOpportunity["stages"],
    founderTypes: f?.founderTypes as RawOpportunity["founderTypes"],
    registrations: f?.registrations as RawOpportunity["registrations"],
    entityTypes: f?.entityTypes as RawOpportunity["entityTypes"],
    confidence: f ? "medium" : "low",
    classifyText: `${f?.title ?? ""}`,
  };
}

async function discover(ctx: SourceContext, state: DiscoveryState, statePath: string): Promise<void> {
  const sitemap = parseSitemap((await ctx.http.getText(SITEMAP, { timeoutMs: 60_000 })).text);
  if (!sitemap.length) throw new Error("discovery sitemap is empty");
  const live = new Set(sitemap.map(e => e.loc));
  for (const k of Object.keys(state.programs)) if (!live.has(k)) delete state.programs[k];

  let todo = sitemap.filter(e => {
    const prev = state.programs[e.loc];
    return !prev || prev.lastmod !== e.lastmod;
  });
  if (ctx.limit) todo = todo.slice(0, ctx.limit);
  ctx.log.info(`sitemap: ${sitemap.length} programs, ${todo.length} new or changed`);

  let done = 0;
  await pool(
    todo,
    2,
    async e => {
      const res = await ctx.http.getText(e.loc, { maxBytes: 90_000, acceptStatus: [404, 410] });
      const ld = res.status < 300 ? parseProgramLd(res.text) : null;
      state.programs[e.loc] = { lastmod: e.lastmod, name: ld?.name ?? null, funder: ld?.funder ?? null, officialUrl: ld?.officialUrl ?? null, checkedAt: ctx.today };
      if (++done % SAVE_EVERY === 0) {
        ctx.log.info(`discovery ${done}/${todo.length}`);
        await saveState(statePath, state);
      }
    },
    (err, e) => ctx.log.debug(`discovery failed for ${e.loc}: ${(err as Error).message}`),
  );
}

async function enrich(ctx: SourceContext, state: DiscoveryState, statePath: string, urls: string[]): Promise<void> {
  const staleBefore = addDays(ctx.today, -OFFICIAL_TTL_DAYS);
  const todo = uniq(urls).filter(u => !SKIP_OFFICIAL.test(u) && (!state.official[u] || state.official[u]!.fetchedAt < staleBefore));
  ctx.log.info(`official pages: ${todo.length} to fetch (${uniq(urls).length - todo.length} fresh in cache or skipped)`);
  let done = 0;
  await pool(todo, 10, async url => {
    try {
      const res = await ctx.http.getText(url, { maxBytes: 1_500_000, timeoutMs: 20_000 });
      const type = res.headers["content-type"] ?? "";
      if (!/html|xml|text\/plain/i.test(type) && type) throw new Error(`unsupported content-type ${type}`);
      const facts = extractPage(res.text);
      if (isErrorPage(facts.title, res.text.length)) throw new Error(`error or login page: ${facts.title.slice(0, 60)}`);
      state.official[url] = { fetchedAt: ctx.today, ok: true, finalUrl: res.url, facts };
    } catch (err) {
      state.official[url] = { fetchedAt: ctx.today, ok: false, error: (err as Error).message.slice(0, 160) };
    }
    if (++done % SAVE_EVERY === 0) {
      ctx.log.info(`official ${done}/${todo.length}`);
      await saveState(statePath, state);
    }
  });
}

export const discovered: OpportunitySource = {
  id: "discovered",
  name: "Discovered programs (official pages)",
  kind: "opportunities",
  homepage: "https://www.startupgrantsindia.com/",
  description:
    "Programs found through the startupgrantsindia.com public sitemap (name, funder and official link only). All other details come from each program's official page.",
  async run(ctx) {
    await mkdir(ctx.stateDir, { recursive: true });
    const statePath = join(ctx.stateDir, "discovery.json");
    const state = await loadState(statePath);
    try {
      await discover(ctx, state, statePath);
      let entries = Object.entries(state.programs);
      if (ctx.limit) entries = entries.slice(0, ctx.limit);
      await enrich(ctx, state, statePath, entries.map(([, d]) => d.officialUrl).filter((u): u is string => !!u));
    } finally {
      await saveState(statePath, state);
    }

    let entries = Object.entries(state.programs);
    if (ctx.limit) entries = entries.slice(0, ctx.limit);
    const out: RawOpportunity[] = [];
    let noLink = 0;
    for (const [loc, d] of entries) {
      const slug = loc.split("/").filter(Boolean).pop()!;
      const opp = toOpportunity(slug, d, d.officialUrl ? state.official[d.officialUrl] : undefined);
      if (opp) out.push(opp);
      else noLink++;
    }
    ctx.log.info(`${out.length} programs with an official link; ${noLink} skipped (no official link published)`);
    return out;
  },
};

export const discoveryHostPolicy = { [DISCOVERY_HOST]: { concurrency: 2, minIntervalMs: 600 } };
