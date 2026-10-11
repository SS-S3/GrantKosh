// Startup ↔ program matching. Pure and dependency-free so the browser (guided advisor) and the
// agent server (Claude's search tool) rank programs identically.
import type { Opportunity } from "./types";

type Stage = Opportunity["stages"][number];
type Founder = Opportunity["founderTypes"][number];
type Entity = Opportunity["entityTypes"][number];

export interface StartupProfile {
  /** Sector slugs from the taxonomy, e.g. ["defence", "drones"]. */
  sectors?: string[];
  stage?: Stage;
  /** Indian state slug, e.g. "karnataka". */
  state?: string;
  founderTypes?: Founder[];
  /** true = has DPIIT recognition, false = doesn't, undefined = unknown. */
  dpiit?: boolean;
  entityType?: Entity;
  /** Rough funding need in INR. */
  needInr?: number;
  /** false = only non-dilutive money. */
  equityOk?: boolean;
  /** Also show non-Indian programs (EU, UK, US, international). */
  international?: boolean;
  includeClosed?: boolean;
}

export interface Match {
  program: Opportunity;
  score: number;
  /** Why it fits, most important first. */
  reasons: string[];
  /** Eligibility risks the founder should check. */
  cautions: string[];
}

/**
 * National flagship schemes founders ask for by name. A small boost keeps them visible when they
 * fit, since aggregator duplicates of the same scheme often carry thinner data.
 */
export const FLAGSHIPS: Array<{ name: string; re: RegExp; sectors?: string[] }> = [
  { name: "iDEX (Ministry of Defence)", re: /\bidex\b|\bdisc\s?\d|\baditi\b|defence india start-?up challenge/i, sectors: ["defence", "drones", "space", "ai", "deeptech", "electronics"] },
  { name: "Technology Development Fund (DRDO)", re: /technology development fund|\btdf\b/i, sectors: ["defence", "deeptech", "electronics"] },
  // Case-sensitive: "Nidhi" alone is a common word in scheme names (e.g. PM SVANidhi).
  { name: "DST NIDHI", re: /\bNIDHI\b|\bPRAYAS\b|[Nn]idhi[- ](?:PRAYAS|SSS|SSP|EIR|EiR|TBI|Prayas)/ },
  { name: "Startup India Seed Fund (SISFS)", re: /seed fund scheme|\bsisfs\b/i },
  { name: "BIRAC BIG / BIPP / SBIRI", re: /\bbirac\b|biotechnology ignition|\bbig\b scheme|\bbipp\b|\bsbiri\b/i, sectors: ["biotech", "healthtech", "medtech", "agritech"] },
  { name: "MeitY TIDE 2.0 / SAMRIDH / GENESIS", re: /\btide\s?2\.0|meity tide|\bsamridh\b|meity genesis/i, sectors: ["it-software", "ai", "electronics", "semiconductors", "cybersecurity", "deeptech"] },
  { name: "Atal Innovation Mission (AIM)", re: /[Aa]tal [Ii]nnovation|[Aa]tal [Nn]ew [Ii]ndia|\bANIC\b|\bAIM\b/ },
  { name: "SIDBI / Fund of Funds", re: /\bsidbi\b|fund of funds/i },
  { name: "Credit Guarantee (CGSS)", re: /credit guarantee scheme for startups|\bcgss\b/i },
  { name: "PMEGP / Stand-Up India", re: /\bpmegp\b|stand-?up india/i },
];

export function flagshipOf(o: Opportunity): string | null {
  const text = `${o.title} ${o.provider}`;
  return FLAGSHIPS.find(f => f.re.test(text))?.name ?? null;
}

const SECTOR_NAMES: Record<string, string> = { "it-software": "IT/software", "ev-mobility": "EV & mobility", ai: "AI" };
const nice = (s: string) => SECTOR_NAMES[s] ?? s.replace(/-/g, " ");
const FOUNDER_NAMES: Record<string, string> = { women: "women founders", "sc-st": "SC/ST founders", student: "student founders", researcher: "researchers/faculty", msme: "MSMEs", minority: "minority founders", divyang: "founders with disability", rural: "rural enterprises", youth: "young founders" };

function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}

const fmtInr = (n: number) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(2)}L` : `₹${n.toLocaleString("en-IN")}`);

/** Score one program for one startup, or null when it is clearly out of scope. */
export function scoreProgram(o: Opportunity, p: StartupProfile, today: string): Match | null {
  const reasons: string[] = [];
  const cautions: string[] = [];
  let score = 0;

  // ---- hard filters ----
  if (o.status === "closed" && !p.includeClosed) return null;
  if (o.country !== "IN" && !p.international) return null;
  if (p.equityOk === false && o.fundingType === "equity") return null;
  const stateBound = o.states.filter(s => s !== "pan-india");
  if (o.country === "IN" && stateBound.length && !o.states.includes("pan-india")) {
    if (!p.state || !stateBound.includes(p.state)) return null;
    score += 15;
    reasons.push(`State programme for ${nice(p.state)}`);
  }

  // ---- sector ----
  const want = p.sectors ?? [];
  const overlap = o.sectors.filter(s => want.includes(s));
  if (want.length) {
    if (overlap.length) {
      score += 18 + 6 * Math.min(overlap.length - 1, 2);
      reasons.push(`Sector fit: ${overlap.map(nice).join(", ")}`);
    } else if (o.sectors.includes("any")) {
      score += 8;
      reasons.push("Open to any sector");
    } else if (o.sectors.length) {
      score -= 14;
    }
  }

  // ---- stage ----
  if (p.stage && o.stages.length) {
    if (o.stages.includes(p.stage)) {
      score += 14;
      reasons.push(`Supports ${p.stage.replace("-", " ")} stage`);
    } else {
      score -= 10;
      cautions.push(`Targets ${o.stages.join("/")} stage`);
    }
  }

  // ---- founder focus ----
  if (o.founderTypes.length) {
    const mine = o.founderTypes.filter(f => p.founderTypes?.includes(f));
    if (mine.length) {
      score += 18;
      reasons.push(`Reserved for ${mine.map(f => FOUNDER_NAMES[f] ?? f).join(", ")}`);
    } else if (!o.founderTypes.every(f => f === "msme" || f === "researcher")) {
      score -= 22;
      cautions.push(`Aimed at ${o.founderTypes.map(f => FOUNDER_NAMES[f] ?? f).join(", ")}`);
    }
  }

  // ---- registrations / entity ----
  if (o.registrations.includes("dpiit")) {
    if (p.dpiit === false) {
      score -= 25;
      cautions.push("Needs DPIIT recognition");
    } else if (p.dpiit) score += 4;
    else cautions.push("Needs DPIIT recognition");
  }
  if (p.entityType && o.entityTypes.length && !o.entityTypes.includes(p.entityType)) {
    score -= 6;
    cautions.push(`Lists ${o.entityTypes.slice(0, 3).join(", ")} as applicants`);
  }

  // ---- money ----
  if (o.equityFree) {
    score += 4;
    if (p.equityOk === false) reasons.push("Non-dilutive");
  }
  if (p.needInr && o.amountMaxInr) {
    if (o.amountMaxInr >= p.needInr) {
      score += 8;
      reasons.push(`Covers your ${fmtInr(p.needInr)} need`);
    } else if (o.amountMaxInr < p.needInr / 4) score -= 6;
  }

  // ---- timing ----
  if (o.status === "open" && o.deadline) {
    const d = daysUntil(o.deadline, today);
    score += d <= 45 ? 12 : 9;
    reasons.push(d <= 14 ? `Closes in ${d} days` : "Open now");
  } else if (o.status === "rolling") {
    score += 7;
    reasons.push("Rolling intake");
  } else if (o.status === "upcoming") {
    score += 5;
    reasons.push("Opening soon");
  } else if (o.status === "closed") {
    score -= 20;
    cautions.push("Closed; watch for the next round");
  }

  // ---- data quality & flagships ----
  if (o.verified) score += 10;
  if (o.confidence === "high") score += 3;
  if (o.confidence === "low") score -= 8;
  const flag = flagshipOf(o);
  if (flag) {
    const f = FLAGSHIPS.find(x => x.name === flag)!;
    const sectorOk = !f.sectors || !want.length || f.sectors.some(s => want.includes(s));
    if (sectorOk) {
      score += 8;
      reasons.push(`Flagship: ${flag}`);
    }
  }
  return { program: o, score, reasons, cautions };
}

/**
 * Rank programs for a profile. `textScores` (from a full-text search) narrows and re-weights
 * the pool when the founder described what they're building in words.
 */
export function rankPrograms(
  all: Opportunity[],
  p: StartupProfile,
  today: string,
  textScores?: Map<string, number> | null,
  limit = 10,
  /** "filter": only text hits (query-only searches). "boost": text hits rank higher, profile fits still count. */
  textMode: "filter" | "boost" = "filter",
): Match[] {
  const maxText = textScores ? Math.max(1, ...textScores.values()) : 1;
  const out: Match[] = [];
  for (const o of all) {
    if (textScores && textMode === "filter" && !textScores.has(o.id)) continue;
    const m = scoreProgram(o, p, today);
    if (!m) continue;
    if (textScores?.has(o.id)) m.score += 25 * (textScores.get(o.id)! / maxText);
    out.push(m);
  }
  out.sort((a, b) => b.score - a.score || a.program.title.localeCompare(b.program.title));
  // Several sources often list the same scheme under one name; keep the best-scored copy.
  const seen = new Set<string>();
  return out.filter(m => {
    const key = m.program.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
