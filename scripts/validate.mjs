// Validates data/curated/grants.json. Run: node scripts/validate.mjs
import { readFileSync } from "node:fs";

const TYPES = ["grant", "challenge", "loan", "subsidy", "fellowship", "accelerator", "international"];
const STAGES = ["idea", "prototype", "early-revenue", "growth"];
const FOUNDERS = ["any", "women", "sc-st", "student", "researcher"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const data = JSON.parse(readFileSync(new URL("../data/curated/grants.json", import.meta.url)));
const errors = [];
const ids = new Set();
const err = (g, msg) => errors.push(`[${g.id ?? "?"}] ${msg}`);

if (!Array.isArray(data)) throw new Error("grants.json must be an array");

for (const g of data) {
  for (const k of ["id", "name", "provider", "type", "summary", "fundingNote", "cadence", "url"])
    if (typeof g[k] !== "string" || !g[k].trim()) err(g, `missing string field "${k}"`);
  if (g.id && !/^[a-z0-9-]+$/.test(g.id)) err(g, "id must be lowercase-kebab-case");
  if (ids.has(g.id)) err(g, "duplicate id"); ids.add(g.id);
  if (!TYPES.includes(g.type)) err(g, `type must be one of ${TYPES.join(", ")}`);
  for (const k of ["fundingMin", "fundingMax"]) if (!Number.isFinite(g[k]) || g[k] < 0) err(g, `${k} must be a non-negative number (INR)`);
  if (g.fundingMin > g.fundingMax) err(g, "fundingMin > fundingMax");
  for (const k of ["equityFree", "requiresDPIIT", "verified"]) if (typeof g[k] !== "boolean") err(g, `${k} must be boolean`);
  for (const k of ["stages", "sectors", "states", "founderTypes", "eligibility"]) if (!Array.isArray(g[k]) || !g[k].length) err(g, `${k} must be a non-empty array`);
  (g.stages || []).forEach(s => STAGES.includes(s) || err(g, `unknown stage "${s}"`));
  (g.founderTypes || []).forEach(s => FOUNDERS.includes(s) || err(g, `unknown founderType "${s}"`));
  if (g.url && !/^https:\/\//.test(g.url)) err(g, "url must be https and point to the official source");
  if (g.deadline !== null && !DATE.test(g.deadline ?? "")) err(g, "deadline must be YYYY-MM-DD or null");
  if (g.lastVerified !== null && !DATE.test(g.lastVerified ?? "")) err(g, "lastVerified must be YYYY-MM-DD or null");
  if (g.verified && !g.lastVerified) err(g, "verified entries need lastVerified");
}

if (errors.length) { console.error(errors.join("\n")); console.error(`\n✗ ${errors.length} problem(s)`); process.exit(1); }
console.log(`✓ ${data.length} programs valid`);
