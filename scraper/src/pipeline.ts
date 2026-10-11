// Orchestrates a scrape: run sources → normalise → validate → dedupe → write JSON.
//
// Resilience rules:
// - A source that throws keeps its previous records (marked stale in meta.json), so one broken
//   site never empties the directory.
// - A source whose record count collapses (< 40% of last run) is treated as broken too, unless
//   --accept-drops is passed. Layout changes usually look like this.
// - Sources not selected with --only are carried over from the previous output unchanged.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpClient } from "./core/http.js";
import { createLogger } from "./core/log.js";
import { FX_TO_INR } from "./core/money.js";
import { computeStatus, normalizeInvestor, normalizeOpportunity } from "./core/normalize.js";
import {
  type DatasetMeta, type Investor, InvestorSchema, type Opportunity, OpportunitySchema, type SourceMeta,
} from "./core/schema.js";
import { titleKey, uniq, urlKey } from "./core/text.js";
import { discoveryHostPolicy } from "./sources/discovered.js";
import { SOURCES } from "./sources/index.js";
import type { Source, SourceContext } from "./sources/types.js";

export interface RunOptions {
  outDir: string;
  stateDir: string;
  cacheDir: string | null;
  today: string;
  only: string[] | null;
  skip: string[];
  limit: number | null;
  acceptDrops: boolean;
  dryRun: boolean;
}

const log = createLogger("pipeline");

interface Previous {
  opportunities: Opportunity[];
  investors: Investor[];
  meta: DatasetMeta | null;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function loadPrevious(outDir: string): Promise<Previous> {
  return {
    opportunities: await readJson<Opportunity[]>(join(outDir, "opportunities.json"), []),
    investors: await readJson<Investor[]>(join(outDir, "investors.json"), []),
    meta: await readJson<DatasetMeta | null>(join(outDir, "meta.json"), null),
  };
}

/** One record per line: compact, but still diff-friendly in git. */
function jsonLines(records: unknown[]): string {
  return records.length ? "[\n" + records.map(r => JSON.stringify(r)).join(",\n") + "\n]\n" : "[]\n";
}

function refreshStatus(o: Opportunity, today: string): Opportunity {
  if (!o.deadline && !o.opensAt) return o;
  return { ...o, status: computeStatus({ ...o, statusHint: o.status }, today) };
}

interface SourceResult<T> {
  records: T[];
  meta: SourceMeta;
}

async function runSource(source: Source, ctx: SourceContext, prev: Previous, opts: RunOptions): Promise<SourceResult<Opportunity | Investor>> {
  const started = Date.now();
  const prevRecords: Array<Opportunity | Investor> =
    source.kind === "opportunities" ? prev.opportunities.filter(o => o.source === source.id) : prev.investors.filter(i => i.source === source.id);
  const prevMeta = prev.meta?.sources.find(s => s.id === source.id);
  const base = { id: source.id, name: source.name, kind: source.kind, homepage: source.homepage, description: source.description };

  const fallback = (error: string): SourceResult<Opportunity | Investor> => {
    log.error(`${source.id}: ${error} — keeping ${prevRecords.length} records from last run`);
    const records = source.kind === "opportunities" ? (prevRecords as Opportunity[]).map(o => refreshStatus(o, opts.today)) : prevRecords;
    return {
      records,
      meta: { ...base, ok: false, stale: prevRecords.length > 0, count: records.length, rejected: 0, durationMs: Date.now() - started, error, lastSuccess: prevMeta?.lastSuccess ?? null },
    };
  };

  let raw: unknown[];
  try {
    raw = await source.run(ctx);
  } catch (err) {
    return fallback((err as Error).message);
  }

  const records: Array<Opportunity | Investor> = [];
  const reasons = new Map<string, number>();
  for (const r of raw) {
    const input = source.kind === "opportunities" ? normalizeOpportunity(source.id, r as never, opts.today) : normalizeInvestor(source.id, r as never, opts.today);
    const parsed = source.kind === "opportunities" ? OpportunitySchema.safeParse(input) : InvestorSchema.safeParse(input);
    if (parsed.success) records.push(parsed.data);
    else {
      const issue = parsed.error.issues[0]!;
      const key = `${issue.path.join(".")}: ${issue.message}`;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  }
  const rejected = raw.length - records.length;
  if (rejected) log.warn(`${source.id}: rejected ${rejected} invalid records`, Object.fromEntries([...reasons].slice(0, 4)));

  if (!records.length) return fallback("returned zero valid records");
  if (!opts.limit && !opts.acceptDrops && prevRecords.length >= 20 && records.length < prevRecords.length * 0.4) {
    return fallback(`record count fell from ${prevRecords.length} to ${records.length} (pass --accept-drops if expected)`);
  }

  log.info(`${source.id}: ${records.length} records in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return {
    records,
    meta: { ...base, ok: true, stale: false, count: records.length, rejected, durationMs: Date.now() - started, error: null, lastSuccess: new Date().toISOString() },
  };
}

// ---------- dedupe ----------

function tokens(s: string): Set<string> {
  return new Set(titleKey(s).split(" ").filter(w => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Fill gaps in `winner` from `other` (same program, lower-priority source). */
function mergeInto(winner: Opportunity, other: Opportunity): Opportunity {
  const pick = <K extends keyof Opportunity>(k: K) => (winner[k] == null || winner[k] === "" ? other[k] : winner[k]);
  const merged: Opportunity = {
    ...winner,
    summary: pick("summary"),
    applyUrl: pick("applyUrl"),
    amountMax: pick("amountMax"),
    amountMin: winner.amountMax == null ? other.amountMin : winner.amountMin,
    currency: winner.amountMax == null ? other.currency : winner.currency,
    amountMaxInr: pick("amountMaxInr"),
    deadline: pick("deadline"),
    opensAt: pick("opensAt"),
    sectors: winner.sectors.length ? winner.sectors : other.sectors,
    tags: uniq([...winner.tags, ...other.tags]).slice(0, 16),
    alsoListedOn: uniq([...winner.alsoListedOn, other.source, ...other.alsoListedOn]).filter(s => s !== winner.source),
    firstSeen: winner.firstSeen < other.firstSeen ? winner.firstSeen : other.firstSeen,
  };
  return merged;
}

export function dedupe(records: Opportunity[], priority: string[]): Opportunity[] {
  const rank = (s: string) => {
    const i = priority.indexOf(s);
    return i < 0 ? priority.length : i;
  };
  const sorted = [...records].sort((a, b) => rank(a.source) - rank(b.source));
  const kept: Opportunity[] = [];
  const byTitle = new Map<string, number>();
  const byUrl = new Map<string, number[]>();

  for (const r of sorted) {
    const tk = `${r.country}|${titleKey(r.title)}`;
    const uk = urlKey(r.url);
    const rTokens = tokens(r.title);
    let match = byTitle.get(tk);
    if (match === undefined) {
      // Same official page *and* similar name. A shared portal URL alone isn't enough,
      // since many state programs link to one landing page.
      match = (byUrl.get(uk) ?? []).find(i => jaccard(tokens(kept[i]!.title), rTokens) >= 0.5);
    }
    // Never merge two records of the same source; they are distinct programs by construction.
    if (match !== undefined && kept[match]!.source !== r.source) {
      kept[match] = mergeInto(kept[match]!, r);
      continue;
    }
    const idx = kept.push(r) - 1;
    if (!byTitle.has(tk)) byTitle.set(tk, idx);
    byUrl.set(uk, [...(byUrl.get(uk) ?? []), idx]);
  }
  return kept;
}

// ---------- run ----------

export async function runPipeline(opts: RunOptions): Promise<DatasetMeta> {
  const prev = await loadPrevious(opts.outDir);
  const http = new HttpClient({ cacheDir: opts.cacheDir, hostPolicies: { ...discoveryHostPolicy, "api.grants.gov": { concurrency: 4, minIntervalMs: 250 } } });

  const selected = SOURCES.filter(s => (!opts.only || opts.only.includes(s.id)) && !opts.skip.includes(s.id));
  const unknown = (opts.only ?? []).filter(id => !SOURCES.some(s => s.id === id));
  if (unknown.length) throw new Error(`unknown source(s): ${unknown.join(", ")}. Known: ${SOURCES.map(s => s.id).join(", ")}`);
  log.info(`running ${selected.length} source(s): ${selected.map(s => s.id).join(", ")}`);

  // Sources hit different hosts, so they run in parallel; the HTTP client still rate-limits per host.
  const results = await Promise.all(
    selected.map(source =>
      runSource(source, { http, log: createLogger(source.id), today: opts.today, stateDir: opts.stateDir, limit: opts.limit }, prev, opts),
    ),
  );

  // Carry over sources that weren't run this time.
  const ranIds = new Set(selected.map(s => s.id));
  const carriedOpps = prev.opportunities.filter(o => !ranIds.has(o.source)).map(o => refreshStatus(o, opts.today));
  const carriedInv = prev.investors.filter(i => !ranIds.has(i.source));
  const carriedMeta = (prev.meta?.sources ?? []).filter(s => !ranIds.has(s.id) && SOURCES.some(x => x.id === s.id));

  // Preserve firstSeen across runs.
  const firstSeen = new Map<string, string>();
  for (const r of [...prev.opportunities, ...prev.investors]) firstSeen.set(r.id, r.firstSeen);
  const withHistory = <T extends { id: string; firstSeen: string }>(r: T): T => ({ ...r, firstSeen: firstSeen.get(r.id) ?? r.firstSeen });

  const freshOpps = results.filter((_, i) => selected[i]!.kind === "opportunities").flatMap(r => r.records as Opportunity[]);
  const freshInv = results.filter((_, i) => selected[i]!.kind === "investors").flatMap(r => r.records as Investor[]);

  // Records already merged into another source last run come back unmerged from that source,
  // so dedupe runs over the full set every time.
  const allOpps = [...freshOpps, ...carriedOpps].map(withHistory).map(o => ({ ...o, alsoListedOn: [] as string[] }));
  const opportunities = dedupe(allOpps, SOURCES.map(s => s.id)).sort((a, b) => a.id.localeCompare(b.id));
  const investors = [...freshInv, ...carriedInv].map(withHistory).sort((a, b) => a.id.localeCompare(b.id));

  const meta: DatasetMeta = {
    generatedAt: new Date().toISOString(),
    opportunities: opportunities.length,
    investors: investors.length,
    sources: [...results.map(r => r.meta), ...carriedMeta].sort((a, b) => SOURCES.findIndex(s => s.id === a.id) - SOURCES.findIndex(s => s.id === b.id)),
    fxToInr: FX_TO_INR,
  };

  log.info(`dedupe: ${allOpps.length} → ${opportunities.length} opportunities; ${investors.length} investors`);
  for (const [host, s] of http.stats) log.debug(`${host}`, s);

  if (opts.dryRun) {
    log.info("dry run — nothing written");
    return meta;
  }
  await mkdir(opts.outDir, { recursive: true });
  await writeFile(join(opts.outDir, "opportunities.json"), jsonLines(opportunities));
  await writeFile(join(opts.outDir, "investors.json"), jsonLines(investors));
  await writeFile(join(opts.outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  log.info(`wrote ${opts.outDir}`);
  return meta;
}
