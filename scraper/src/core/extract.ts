// Generic extractor for an arbitrary official program page: pulls the page's own title and
// description, plus deadline / opening date / funding amount / tags found in its visible text.
import * as cheerio from "cheerio";
import {
  entitiesOf, foundersOf, programTypeOf, registrationsOf, rollingOf, sectorsOf, stagesOf,
} from "./classify.js";
import { findDeadline, findOpening } from "./dates.js";
import { applicantAmountRange, type Range } from "./money.js";
import type { ProgramType } from "./schema.js";
import { clean, htmlLines, truncate } from "./text.js";

export interface PageFacts {
  title: string;
  description: string;
  deadline: string | null;
  opensAt: string | null;
  amount: Range | null;
  rolling: boolean;
  programType: ProgramType;
  sectors: string[];
  stages: string[];
  founderTypes: string[];
  registrations: string[];
  entityTypes: string[];
  mentionsIndia: boolean;
}

const FUNDING_CUE = /\b(grant|fund(?:ing|s)?|support|up ?to|prize|award|seed|assistance|loan|subsid|invest|cash|stipend|reward|worth|amount|budget)\w*/i;

/** Sentences that talk about money, so we don't pick up corpus sizes or company revenue figures. */
function fundingSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter(s => FUNDING_CUE.test(s))
    .join(" \n ");
}

// Hacked government/incubator sites sometimes carry SEO spam in their meta tags.
const SPAM = /\b(gacor|slot ?online|judi|togel|casino|poker|sbobet|maxwin|situs|bet88|jackpot|viagra|cialis|porn|xxx|escort|bokep|sabung)\b/i;
const BOILERPLATE = /(help ?desk|helpline|toll[- ]free|copyright|all rights reserved|cookies?|enable javascript|javascript is (?:disabled|required)|sign in|log ?in to|page not found|\b404\b|access denied|forbidden|under maintenance|loading\.\.\.|skip to (?:main )?content|screen reader)/i;
const ERROR_TITLE = /^(404|403|error|page not found|not found|access denied|forbidden|just a moment|attention required|log ?in|sign ?in)\b/i;

export function isSpam(text: string): boolean {
  return SPAM.test(text);
}

/** A description worth showing: real sentences, not spam, nav text or contact boilerplate. */
export function usableDescription(text: string | null | undefined): string {
  const t = clean(text);
  if (t.split(" ").length < 6 || SPAM.test(t) || BOILERPLATE.test(t)) return "";
  return t;
}

export function isErrorPage(title: string, textLength: number): boolean {
  return ERROR_TITLE.test(clean(title)) && textLength < 3000;
}

export function extractPage(html: string, maxText = 20_000): PageFacts {
  const $ = cheerio.load(html);
  const meta = (sel: string) => clean($(sel).attr("content"));
  const title = meta('meta[property="og:title"]') || clean($("title").first().text()) || clean($("h1").first().text());

  const lines = htmlLines(html, "script,style,noscript,svg,iframe,template,nav,footer,header,form");
  const text = lines.join("\n").slice(0, maxText);
  let description = usableDescription(meta('meta[name="description"]')) || usableDescription(meta('meta[property="og:description"]'));
  if (description.length < 40) description = lines.map(usableDescription).find(l => l.length >= 80) ?? description;

  const head = `${title} ${description}`;
  const body = `${head}\n${text}`;
  return {
    title,
    description: truncate(description, 500),
    deadline: findDeadline(text),
    opensAt: findOpening(text),
    amount: applicantAmountRange(fundingSentences(body)),
    rolling: rollingOf(text),
    programType: programTypeOf(head, programTypeOf(text.slice(0, 3000), "other")),
    sectors: sectorsOf(head + " " + text.slice(0, 4000)),
    stages: stagesOf(body.slice(0, 6000)),
    founderTypes: foundersOf(body.slice(0, 6000)),
    registrations: registrationsOf(body),
    entityTypes: entitiesOf(body.slice(0, 8000)),
    mentionsIndia: /\b(india|indian|bharat|dpiit|msme|₹|rs\.|lakh|crore)\b/i.test(body),
  };
}
