// Hand-maintained entries in data/curated/grants.json. These are checked by people against the
// official source, so they take priority over anything scraped when dedupe finds the same program.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RawOpportunity } from "../core/normalize.js";
import type { ProgramType } from "../core/schema.js";
import type { OpportunitySource } from "./types.js";

export const CURATED_PATH = fileURLToPath(new URL("../../../data/curated/grants.json", import.meta.url));

interface CuratedEntry {
  id: string;
  name: string;
  provider: string;
  type: string;
  fundingMin: number;
  fundingMax: number;
  fundingNote: string;
  equityFree: boolean;
  stages: string[];
  sectors: string[];
  states: string[];
  founderTypes: string[];
  requiresDPIIT: boolean;
  deadline: string | null;
  cadence: string;
  summary: string;
  eligibility: string[];
  url: string;
  lastVerified: string | null;
  verified: boolean;
}

const TYPE_MAP: Record<string, ProgramType> = {
  grant: "grant", challenge: "challenge", loan: "loan", subsidy: "subsidy",
  fellowship: "fellowship", accelerator: "accelerator", international: "grant",
};
const SECTOR_MAP: Record<string, string | null> = {
  software: "it-software", hardware: "electronics", iot: "electronics", quantum: "deeptech", services: null,
};

export function mapCurated(g: CuratedEntry): RawOpportunity {
  const international = g.states.includes("international") || g.type === "international";
  return {
    nativeId: g.id,
    title: g.name,
    provider: g.provider,
    summary: `${g.summary} ${g.fundingNote}`,
    url: g.url,
    programType: TYPE_MAP[g.type] ?? "other",
    equityFree: g.equityFree,
    amountMin: g.fundingMin || null,
    amountMax: g.fundingMax || null,
    currency: "INR",
    deadline: g.deadline,
    rolling: !g.deadline && /rolling|throughout|any ?time/i.test(g.cadence),
    country: international ? "INT" : "IN",
    states: international ? [] : g.states,
    sectors: g.sectors.includes("any") ? ["any"] : g.sectors.map(s => (s in SECTOR_MAP ? SECTOR_MAP[s] : s)).filter((s): s is string => !!s),
    stages: g.stages as RawOpportunity["stages"],
    founderTypes: g.founderTypes.filter(f => f !== "any") as RawOpportunity["founderTypes"],
    registrations: g.requiresDPIIT ? ["dpiit"] : undefined,
    eligibility: g.eligibility,
    cadence: g.cadence,
    verified: g.verified,
    lastVerified: g.lastVerified,
    confidence: "high",
    classifyText: g.eligibility.join(" "),
  };
}

export const curated: OpportunitySource = {
  id: "curated",
  name: "GrantKosh curated",
  kind: "opportunities",
  homepage: "https://github.com/grantkosh/grantkosh/blob/main/data/curated/grants.json",
  description: "Hand-checked entries maintained by GrantKosh contributors.",
  async run() {
    const data = JSON.parse(await readFile(CURATED_PATH, "utf8")) as CuratedEntry[];
    return data.map(mapCurated);
  },
};
