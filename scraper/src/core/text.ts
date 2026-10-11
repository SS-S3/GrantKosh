// Text helpers shared by every adapter.
import * as cheerio from "cheerio";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", rupee: "₹" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Collapse whitespace, decode entities, strip zero-width chars. */
export function clean(s: string | null | undefined): string {
  if (!s) return "";
  return decodeEntities(String(s))
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** HTML fragment to plain text, keeping paragraph/list breaks as sentence gaps. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $("script,style,noscript").remove();
  $("br").replaceWith(" ");
  $("p,li,div,h1,h2,h3,h4,h5,h6,tr").each((_, el) => {
    $(el).append(" ");
  });
  return clean($("#__root").text());
}

/** Shorten at a word boundary and add an ellipsis. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–-]+$/, "") + "…";
}

/** Drop a trailing "..." that sources add when they themselves truncate. */
export function stripTrailingEllipsis(s: string): string {
  return s.replace(/\s*(\.{3,}|…)\s*$/, "").trim();
}

/** Short all-caps words that are ordinary English, not acronyms. */
const COMMON_CAPS = new Set(["AND", "THE", "FOR", "WITH", "FROM", "UNDER", "INTO", "LAST", "DATE", "CALL", "OPEN", "NEW", "GRANT", "FUND", "SEED", "YOUTH", "WOMEN", "APPLY", "ONLY", "OF", "TO", "IN", "ON", "BY", "AT", "AN", "OR", "AS", "IS", "ITS", "ARE", "ALL", "ITS", "HER", "OUR", "NOW", "PHASE", "ROUND", "STAGE", "THIRD", "FIRST", "AWARD", "PRIZE", "AIMS", "BASED", "TECH", "GREEN", "SMART", "WATER", "FOOD", "HEALTH", "RURAL", "URBAN", "STATE", "CYCLE", "TERM", "NOTE", "TIME", "YEAR", "MAY", "JUNE", "JULY", "MARCH", "APRIL"]);

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "under", "with", "via"]);

/**
 * Title-case text that a source publishes in ALL CAPS. Leaves mixed-case text alone
 * and keeps short all-caps tokens (acronyms like BIRAC, DST, PoC) intact.
 */
export function fixShouting(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters || letters.replace(/[^A-Z]/g, "").length / letters.length < 0.8) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      const orig = s.split(" ")[i] ?? w;
      if (/^[A-Z0-9&-]{2,5}$/.test(orig) && !COMMON_CAPS.has(orig)) return orig;
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

export function slugify(s: string): string {
  return clean(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const KEY_STOP = new Set(["the", "of", "for", "and", "a", "an", "scheme", "programme", "program", "yojana", "india", "indian", "call", "proposals", "proposal", "2024", "2025", "2026", "2027"]);

/** Loose identity key for titles, used for cross-source dedupe. */
export function titleKey(s: string): string {
  return clean(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(w => w && !KEY_STOP.has(w))
    .join(" ");
}

const TRACKING_PARAMS = /^(utm_[a-z]+|ref|fbclid|gclid|mc_cid|mc_eid|source)$/i;

/** Remove tracking parameters (utm_*, ref=…) that aggregators append to outbound links. */
export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/** Canonical form of a URL for dedupe: no scheme, no www, no tracking, no trailing slash. */
export function urlKey(url: string): string {
  try {
    const u = new URL(stripTracking(url));
    const host = u.host.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").replace(/\/index\.(html?|php)$/i, "");
    return `${host}${path}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href.trim(), base).toString().replace(/([^:])\/\/+/g, "$1/");
  } catch {
    return href;
  }
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

const BLOCK = "p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,tr,td,th,section,article,header,footer,br,dt,dd,table,blockquote,pre,label,option";

/** Visible text of an HTML document as trimmed lines, one per block element. */
export function htmlLines(html: string, dropSelectors = "script,style,noscript,svg,iframe,template"): string[] {
  const $ = cheerio.load(html);
  $(dropSelectors).remove();
  $(BLOCK).each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return $("body")
    .text()
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);
}
