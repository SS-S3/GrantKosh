import { describe, expect, it } from "vitest";
import { OpportunitySchema, InvestorSchema } from "../src/core/schema.js";
import { normalizeInvestor, normalizeOpportunity } from "../src/core/normalize.js";
import { parseBiracList } from "../src/sources/birac.js";
import { parseIdexList } from "../src/sources/idex.js";
import { parseUkriPage } from "../src/sources/ukri.js";
import { mapEuResult, maxContribution, pickDeadline, type EuResult } from "../src/sources/eu-funding.js";
import { mapMySchemeHit, type MySchemeHit } from "../src/sources/myscheme.js";
import { mapGrantsGov, type GrantsGovHit } from "../src/sources/grants-gov.js";
import { cityState, investorKind, mapSebiCard, parseSebiPage } from "../src/sources/sebi-aif.js";
import { parseProgramLd, parseSitemap, toOpportunity } from "../src/sources/discovered.js";
import { CURATED_PATH, mapCurated } from "../src/sources/curated.js";
import { readFileSync } from "node:fs";
import { fixture, TODAY } from "./helpers.js";

const validOpp = (source: string) => (raw: Parameters<typeof normalizeOpportunity>[1]) => OpportunitySchema.parse(normalizeOpportunity(source, raw, TODAY));

describe("birac", () => {
  const rows = parseBiracList(fixture("birac-cfp.html"));
  it("parses current and previous calls", () => {
    const current = rows.filter(r => r.current);
    expect(current.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(50);
    expect(current[0]).toMatchObject({ id: "119", opensAt: "2026-10-01", deadline: "2026-10-31" });
    expect(current[0]!.title).not.toMatch(/LAST DATE/i);
    expect(current[0]!.url).toBe("https://birac.nic.in/cfp_view.php?id=119&scheme_type=41");
  });
});

describe("idex", () => {
  const cards = parseIdexList(fixture("idex-challenges.html"));
  it("parses challenge cards with deadlines and status", () => {
    expect(cards.length).toBeGreaterThan(5);
    const disc = cards.find(c => c.title === "DISC 14")!;
    expect(disc).toMatchObject({ deadline: "2026-05-04", closed: true });
    expect(new Set(cards.map(c => c.id)).size).toBe(cards.length);
  });
});

describe("ukri", () => {
  const items = parseUkriPage(fixture("ukri-page1.html"));
  it("parses opportunities with dates, funders and amounts", () => {
    expect(items.length).toBeGreaterThanOrEqual(10);
    const adopt = items.find(i => i.nativeId === "adopt-facilitator-support-grant-round-12")!;
    expect(adopt).toMatchObject({ opensAt: "2026-10-01", deadline: "2026-11-11", country: "GB", statusHint: "open", currency: "GBP", amountMax: 2500 });
    expect(adopt.provider).toContain("Innovate UK");
    items.forEach(validOpp("ukri"));
  });
});

describe("eu-funding", () => {
  const data = JSON.parse(fixture("eu-search.json")) as { results: EuResult[] };
  it("maps cascade calls", () => {
    const mapped = data.results.map(r => mapEuResult(r, TODAY)).filter(Boolean);
    expect(mapped.length).toBe(data.results.length);
    expect(mapped[0]!.country).toBe("EU");
    mapped.forEach(m => validOpp("eu-funding")(m!));
  });
  it("picks the next cut-off of a multi-deadline call", () => {
    expect(pickDeadline(["2025-10-31T12:00:00.000+0000", "2026-10-30T12:00:00.000+0000", "2026-06-30T12:00:00.000+0000"], TODAY)).toBe("2026-10-30");
    expect(pickDeadline(["2025-01-01T00:00:00.000+0000"], TODAY)).toBe("2025-01-01");
  });
  it("reads the per-grant max from budgetOverview", () => {
    expect(maxContribution(JSON.stringify({ budgetTopicActionMap: { a: [{ maxContribution: 2000000 }, { maxContribution: 2500000 }] } }))).toBe(2500000);
    expect(maxContribution("not json")).toBeNull();
  });
});

describe("myscheme", () => {
  const hits = (JSON.parse(fixture("myscheme-search.json")) as { data: { hits: { items: MySchemeHit[] } } }).data.hits.items;
  it("maps search hits to valid records", () => {
    const mapped = hits.map(mapMySchemeHit);
    const standup = mapped.find(m => m.nativeId === "sui")!;
    expect(standup).toMatchObject({ provider: "Ministry Of Finance", states: ["pan-india"], url: "https://www.myscheme.gov.in/schemes/sui", deadline: "2025-03-31" });
    expect(standup.programType).toBe("loan");
    mapped.forEach(validOpp("myscheme"));
  });
});

describe("grants-gov", () => {
  const hits = (JSON.parse(fixture("grantsgov-search.json")) as { data: { oppHits: GrantsGovHit[] } }).data.oppHits;
  it("maps list hits (US date order) without details", () => {
    const m = mapGrantsGov(hits[0]!, null);
    expect(m.country).toBe("US");
    expect(m.url).toBe(`https://www.grants.gov/search-results-detail/${hits[0]!.id}`);
    hits.map(h => mapGrantsGov(h, null)).forEach(validOpp("grants-gov"));
  });
  it("uses award ceiling and applicant types from details", () => {
    const m = mapGrantsGov(hits[0]!, {
      synopsisDesc: "<p>Support for small business innovation.</p>",
      awardCeiling: "250000",
      awardFloor: "50000",
      applicantTypes: [{ id: "23", description: "Small businesses" }],
      fundingInstruments: [{ id: "G", description: "Grant" }],
    });
    expect(m).toMatchObject({ amountMax: 250000, amountMin: 50000, currency: "USD", programType: "grant", entityTypes: ["private-limited"] });
  });
});

describe("sebi-aif", () => {
  const { cards, total } = parseSebiPage(fixture("sebi-aif-page0.html"));
  it("parses the register page", () => {
    expect(total).toBeGreaterThan(1000);
    expect(cards.length).toBe(25);
  });
  it("maps cards to investors, skipping unnamed ones", () => {
    const mapped = cards.map(mapSebiCard).filter(Boolean);
    expect(mapped.length).toBeGreaterThan(20);
    for (const m of mapped) InvestorSchema.parse(normalizeInvestor("sebi-aif", m!, TODAY));
    const c = mapped.find(m => m!.name === "021 Capital Trust")!;
    expect(c).toMatchObject({ category: "AIF Category I", kind: "venture-capital", city: "Bangalore", state: "Karnataka", registeredOn: "2017-11-06", email: "sailesh@021.capital" });
  });
  it("classifies fund kinds", () => {
    expect(investorKind("Indian Angel Network Fund", "AIF Category I")).toBe("angel-fund");
    expect(investorKind("Alpha Credit Opportunities Fund", "AIF Category II")).toBe("venture-debt");
    expect(investorKind("Quant Alpha Fund", "AIF Category III")).toBe("hedge");
  });
  it("splits city and state from the address", () => {
    expect(cityState("2B, Samved, Navrangpura, Ahmedabad, AHMEDABAD, GUJARAT, 380059")).toEqual({ city: "Ahmedabad", state: "Gujarat" });
  });
});

describe("discovered", () => {
  it("reads only English program URLs from the sitemap", () => {
    const entries = parseSitemap(fixture("sgi-sitemap.xml"));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(e => !e.loc.includes("/hindi/"))).toBe(true);
    expect(entries[0]!.lastmod).toMatch(/^2026-/);
  });
  it("keeps only name, funder and the cleaned official link", () => {
    const ld = parseProgramLd(fixture("sgi-program-head.html"));
    expect(ld).toEqual({ name: "Example Seed Grant 2026", funder: "Example Startup Mission", officialUrl: "https://startup.example.gov.in/seed-grant?round=3" });
  });
  it("builds records from official facts only", () => {
    const rec = toOpportunity("example-1", { lastmod: null, checkedAt: TODAY, name: "Example Seed Grant 2026", funder: "Kerala Startup Mission", officialUrl: "https://startup.example.gov.in/seed-grant" }, undefined)!;
    expect(rec).toMatchObject({ url: "https://startup.example.gov.in/seed-grant", summary: "", amountMax: null, country: "IN", states: ["kerala"], confidence: "low" });
    expect(toOpportunity("x", { lastmod: null, checkedAt: TODAY, name: "No link", funder: null, officialUrl: null }, undefined)).toBeNull();
  });
});

describe("curated", () => {
  it("maps every curated entry to a valid record", () => {
    const data = JSON.parse(readFileSync(CURATED_PATH, "utf8"));
    const out = data.map(mapCurated).map(validOpp("curated"));
    expect(out.length).toBe(data.length);
    expect(out.find((o: { id: string }) => o.id === "curated:eic-accelerator").country).toBe("INT");
  });
});
