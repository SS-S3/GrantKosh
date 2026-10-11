// The advisor's tools. The model never sees the raw dataset, only what these return, so every
// recommendation it makes is grounded in a real record with an id the UI can open.
import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { amountLabel } from "../../web/src/format";
import { ENTITY, FOUNDER, INVESTOR_KIND, PROGRAM_TYPE, SECTOR, STAGE, STATES } from "../../web/src/labels";
import { rankPrograms, type Match, type StartupProfile } from "../../web/src/match";
import type { Opportunity } from "../../web/src/types";
import { type Dataset, todayIso } from "./data";

const SECTORS = Object.keys(SECTOR).filter(s => s !== "any" && s !== "biotechnology") as [string, ...string[]];
const STAGES = Object.keys(STAGE) as [string, ...string[]];
const FOUNDERS = Object.keys(FOUNDER) as [string, ...string[]];
const ENTITIES = Object.keys(ENTITY) as [string, ...string[]];
const STATE_SLUGS = Object.keys(STATES).filter(s => s !== "pan-india") as [string, ...string[]];
const PROGRAM_TYPES = Object.keys(PROGRAM_TYPE) as [string, ...string[]];
const INVESTOR_KINDS = Object.keys(INVESTOR_KIND) as [string, ...string[]];

// ---------- input schemas (model arguments are untrusted: validate before running) ----------

export const FindProgramsInput = z.object({
  query: z.string().max(300).optional(),
  sectors: z.array(z.enum(SECTORS)).max(6).optional(),
  stage: z.enum(STAGES).optional(),
  state: z.enum(STATE_SLUGS).optional(),
  founder_types: z.array(z.enum(FOUNDERS)).max(5).optional(),
  dpiit: z.boolean().optional(),
  entity_type: z.enum(ENTITIES).optional(),
  need_inr: z.number().nonnegative().optional(),
  equity_ok: z.boolean().optional(),
  international: z.boolean().optional(),
  include_closed: z.boolean().optional(),
  program_types: z.array(z.enum(PROGRAM_TYPES)).max(6).optional(),
  limit: z.number().int().min(1).max(12).optional(),
});

export const GetProgramInput = z.object({ id: z.string().min(3).max(200) });

export const FindInvestorsInput = z.object({
  query: z.string().max(200).optional(),
  kinds: z.array(z.enum(INVESTOR_KINDS)).max(5).optional(),
  state: z.string().max(60).optional(),
  category: z.enum(["AIF Category I", "AIF Category II", "AIF Category III"]).optional(),
  limit: z.number().int().min(1).max(15).optional(),
});

// ---------- function declarations sent to Gemini ----------

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "find_programs",
    description:
      "Search the GrantKosh directory (Indian central/state schemes, iDEX, NIDHI, BIRAC, MeitY, SISFS, incubator and CSR programmes, accelerators, plus EU/UK/US grants) and rank programmes for a startup profile. " +
      "Returns the best matches with an id, funding, status/deadline, why it fits and eligibility cautions. " +
      "Pass every profile fact you know; omit unknown fields rather than guessing. Use `query` for what the startup builds or specific scheme names (e.g. 'counter-drone radar', 'NIDHI PRAYAS', 'iDEX'). " +
      "Call it again with a different query or filters to cover another angle (e.g. once for sector schemes, once for state schemes).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text: product/technology, keywords or scheme names." },
        sectors: { type: "array", items: { type: "string", enum: SECTORS }, description: "Sector slugs that describe the startup." },
        stage: { type: "string", enum: STAGES, description: "idea | prototype (MVP) | early-revenue | growth." },
        state: { type: "string", enum: STATE_SLUGS, description: "Indian state where the startup is registered/operates (slug)." },
        founder_types: { type: "array", items: { type: "string", enum: FOUNDERS }, description: "Only groups the founders actually belong to." },
        dpiit: { type: "boolean", description: "Whether the startup has DPIIT recognition." },
        entity_type: { type: "string", enum: ENTITIES },
        need_inr: { type: "number", description: "Approximate funding need in INR." },
        equity_ok: { type: "boolean", description: "false if the founder wants only non-dilutive money." },
        international: { type: "boolean", description: "Include EU/UK/US/international programmes." },
        include_closed: { type: "boolean", description: "Include closed programmes (useful to show schemes that reopen yearly)." },
        program_types: { type: "array", items: { type: "string", enum: PROGRAM_TYPES }, description: "Restrict to these programme types." },
        limit: { type: "integer", minimum: 1, maximum: 12, description: "Max results (default 8)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_program",
    description: "Full record for one programme by id (eligibility list, all tags, dates, official and apply links). Use before giving detailed eligibility advice.",
    parametersJsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "find_investors",
    description:
      "Search SEBI-registered Alternative Investment Funds (venture capital, angel funds, PE, venture debt). Only name, SEBI category, inferred type, city/state and public email are known, NOT their thesis or ticket size.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Fund name words or city." },
        kinds: { type: "array", items: { type: "string", enum: INVESTOR_KINDS } },
        state: { type: "string", description: "Indian state name, e.g. Karnataka." },
        category: { type: "string", enum: ["AIF Category I", "AIF Category II", "AIF Category III"] },
        limit: { type: "integer", minimum: 1, maximum: 15 },
      },
      additionalProperties: false,
    },
  },
];

// ---------- handlers ----------

export interface ToolOutcome {
  /** Result object returned to the model. */
  content: Record<string, unknown>;
  /** Short status line for the UI. */
  label: string;
  /** Programme matches surfaced by this call, for the UI's result cards. */
  matches?: Match[];
  isError?: boolean;
}

function compact(m: Match) {
  const o = m.program;
  return {
    id: o.id,
    title: o.title,
    provider: o.provider,
    type: o.programType,
    funding: amountLabel(o) || "not stated",
    funding_type: o.fundingType,
    status: o.status,
    deadline: o.deadline,
    opens: o.opensAt,
    where: o.country === "IN" ? o.states.join(", ") : o.country,
    sectors: o.sectors.slice(0, 5),
    summary: o.summary.length > 240 ? o.summary.slice(0, 237) + "…" : o.summary,
    verified: o.verified,
    data_quality: o.confidence,
    why: m.reasons.slice(0, 4),
    check: m.cautions.slice(0, 3),
  };
}

export function findPrograms(ds: Dataset, raw: unknown, today = todayIso()): ToolOutcome {
  const input = FindProgramsInput.parse(raw);
  const profile: StartupProfile = {
    sectors: input.sectors,
    stage: input.stage as StartupProfile["stage"],
    state: input.state,
    founderTypes: input.founder_types as StartupProfile["founderTypes"],
    dpiit: input.dpiit,
    entityType: input.entity_type as StartupProfile["entityType"],
    needInr: input.need_inr,
    equityOk: input.equity_ok,
    international: input.international,
    includeClosed: input.include_closed,
  };
  const pool = input.program_types?.length ? ds.opportunities.filter(o => input.program_types!.includes(o.programType)) : ds.opportunities;
  const text = input.query?.trim() ? new Map(ds.oppIndex.search(input.query).map(r => [r.id as string, r.score])) : null;
  const limit = input.limit ?? 8;
  // With profile facts, the query only boosts; with nothing else to go on, it filters.
  const hasProfile = !!(input.sectors?.length || input.stage || input.state || input.founder_types?.length);
  let matches = rankPrograms(pool, profile, today, text, limit, hasProfile ? "boost" : "filter");
  // A very specific query can miss on wording; fall back to profile-only ranking rather than return nothing.
  let note: string | undefined;
  if (!matches.length && text) {
    matches = rankPrograms(pool, profile, today, null, limit);
    note = `No programme text matched "${input.query}"; showing best profile matches instead.`;
  }
  const q = input.query && (input.query.length > 48 ? `${input.query.slice(0, 47)}…` : input.query);
  const facets = [q && `"${q}"`, input.sectors?.join("/"), input.stage, input.state].filter(Boolean).join(", ");
  return {
    content: { today, considered: pool.length, note, results: matches.map(compact) },
    label: `Searched ${pool.length.toLocaleString("en-IN")} programmes${facets ? ` for ${facets}` : ""}: ${matches.length} matches`,
    matches,
  };
}

export function getProgram(ds: Dataset, raw: unknown): ToolOutcome {
  const { id } = GetProgramInput.parse(raw);
  const o: Opportunity | undefined = ds.byId.get(id);
  if (!o) return { content: { error: `No programme with id ${id}` }, label: `Looked up ${id}`, isError: true };
  const { amountMaxInr: _a, firstSeen: _f, ...rest } = o;
  return { content: { ...rest, funding: amountLabel(o) || "not stated" }, label: `Read details: ${o.title}` };
}

export function findInvestors(ds: Dataset, raw: unknown): ToolOutcome {
  const input = FindInvestorsInput.parse(raw);
  const hits = input.query?.trim() ? new Set(ds.invIndex.search(input.query).map(r => r.id as string)) : null;
  const state = input.state?.toLowerCase();
  const rows = ds.investors
    .filter(i => (!hits || hits.has(i.id)) && (!input.kinds?.length || input.kinds.includes(i.kind)) && (!state || i.state?.toLowerCase() === state) && (!input.category || i.category === input.category))
    .sort((a, b) => (b.registeredOn ?? "").localeCompare(a.registeredOn ?? ""))
    .slice(0, input.limit ?? 10)
    .map(i => ({ id: i.id, name: i.name, type: i.kind, category: i.category, city: i.city, state: i.state, email: i.email, registered: i.registeredOn }));
  return {
    content: { note: "SEBI register data only: no investment thesis or ticket size known.", results: rows },
    label: `Searched ${ds.investors.length.toLocaleString("en-IN")} SEBI-registered funds: ${rows.length} matches`,
  };
}

export function runTool(ds: Dataset, name: string, input: unknown): ToolOutcome {
  try {
    switch (name) {
      case "find_programs":
        return findPrograms(ds, input);
      case "get_program":
        return getProgram(ds, input);
      case "find_investors":
        return findInvestors(ds, input);
      default:
        return { content: { error: `Unknown tool ${name}` }, label: `Unknown tool ${name}`, isError: true };
    }
  } catch (err) {
    // Includes zod validation failures from truncated or malformed streamed inputs.
    const message = err instanceof z.ZodError ? `INVALID_INPUT: ${err.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}` : (err as Error).message;
    return { content: { error: message }, label: `Tool ${name} failed`, isError: true };
  }
}
