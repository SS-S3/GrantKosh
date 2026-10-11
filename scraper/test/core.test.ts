import { describe, expect, it } from "vitest";
import { foundersOf, programTypeOf, sectorsOf, stateSlug, statesOf } from "../src/core/classify.js";
import { findDeadline, parseDate } from "../src/core/dates.js";
import { extractPage } from "../src/core/extract.js";
import { amountRange, findAmounts } from "../src/core/money.js";
import { computeStatus, normalizeOpportunity } from "../src/core/normalize.js";
import { OpportunitySchema } from "../src/core/schema.js";
import { fixShouting, stripTracking, titleKey, urlKey } from "../src/core/text.js";
import { dedupe } from "../src/pipeline.js";
import { TODAY } from "./helpers.js";

describe("parseDate", () => {
  it.each([
    ["2026-10-31", "2026-10-31"],
    ["2026-06-28T22:59:00.000+0000", "2026-06-28"],
    ["31-10-2026 05:30 PM", "2026-10-31"],
    ["15-Jul-2026", "2026-07-15"],
    ["04 May, 2026", "2026-05-04"],
    ["Opens on 01st October 2026", "2026-10-01"],
    ["Jul 23, 2025 - Perpetual", "2025-07-23"],
    ["1 October 2026 9:30am UK time", "2026-10-01"],
    ["31/06/2026", null],
    ["no date here", null],
  ])("%s → %s", (input, want) => expect(parseDate(input)).toBe(want));

  it("respects month-first order for US sources", () => {
    expect(parseDate("11/05/2026", "mdy")).toBe("2026-11-05");
    expect(parseDate("11/05/2026")).toBe("2026-05-11");
    expect(parseDate("11/17/2026")).toBe("2026-11-17"); // unambiguous either way
  });

  it("finds the deadline after a cue, not the first date on the page", () => {
    const text = "Launched on 12 May 2026. Applications are reviewed monthly. Last date to apply: 30th November 2026.";
    expect(findDeadline(text)).toBe("2026-11-30");
  });
});

describe("money", () => {
  it.each([
    ["Grant up to ₹50 lakh", 5_000_000, "INR"],
    ["Rs.1.5 Cr per winner", 15_000_000, "INR"],
    ["up to INR 25,00,000", 2_500_000, "INR"],
    ["support of 25 lakh", 2_500_000, "INR"],
    ["a grant of £2,500", 2_500, "GBP"],
    ["EUR 50,000 in grants", 50_000, "EUR"],
    ["$100k credits", 100_000, "USD"],
    ["₹10L seed", 1_000_000, "INR"],
  ])("%s", (text, value, currency) => {
    const [a] = findAmounts(text);
    expect(a).toMatchObject({ value, currency });
  });

  it("ignores bare numbers", () => {
    expect(findAmounts("Founded in 2019 with 45 employees and 3 offices")).toEqual([]);
  });

  it("returns a range in the dominant currency", () => {
    expect(amountRange("Loans from ₹10 lakh to ₹1 crore; processing fee ₹500")).toEqual({ min: 1_000_000, max: 10_000_000, currency: "INR" });
  });
});

describe("classify", () => {
  it("tags sectors without matching common words", () => {
    expect(sectorsOf("AI-enabled diagnostics for rural hospitals")).toEqual(expect.arrayContaining(["ai", "healthtech", "rural"]));
    expect(sectorsOf("It is a scheme for her business")).toEqual([]);
  });
  it("detects founder types", () => {
    expect(foundersOf("Support for women and SC/ST entrepreneurs")).toEqual(expect.arrayContaining(["women", "sc-st"]));
  });
  it("orders program types most-specific first", () => {
    expect(programTypeOf("Climate Tech Launchpad accelerator cohort with grants")).toBe("accelerator");
    expect(programTypeOf("Credit Guarantee Scheme for Startups")).toBe("loan");
    expect(programTypeOf("Defence India Startup Challenge")).toBe("challenge");
  });
  it("maps state names and aliases", () => {
    expect(stateSlug("TAMIL NADU")).toBe("tamil-nadu");
    expect(stateSlug("Jammu and Kashmir")).toBe("jammu-kashmir");
    expect(stateSlug("All")).toBe("pan-india");
    expect(statesOf("Kerala Startup Mission (KSUM) Seed Fund")).toEqual(["kerala"]);
  });
});

describe("text", () => {
  it("strips tracking parameters but keeps real ones", () => {
    expect(stripTracking("https://x.in/a?utm_source=y&ref=z&round=3")).toBe("https://x.in/a?round=3");
  });
  it("builds loose keys for dedupe", () => {
    expect(urlKey("https://www.Example.gov.in/scheme/?utm_source=a")).toBe(urlKey("http://example.gov.in/scheme"));
    expect(titleKey("Startup India Seed Fund Scheme (SISFS)")).toBe(titleKey("Startup India Seed Fund"));
  });
  it("de-shouts all-caps titles but keeps acronyms", () => {
    expect(fixShouting("BIRAC INVITES APPLICATIONS UNDER BIG SCHEME")).toBe("BIRAC Invites Applications under BIG Scheme");
    expect(fixShouting("Already Mixed Case")).toBe("Already Mixed Case");
  });
});

describe("status", () => {
  it("derives status from dates first, then the source's own hint", () => {
    expect(computeStatus({ deadline: "2026-10-01" }, TODAY)).toBe("closed");
    expect(computeStatus({ deadline: "2026-12-01", opensAt: "2026-11-01" }, TODAY)).toBe("upcoming");
    expect(computeStatus({ deadline: "2026-12-01" }, TODAY)).toBe("open");
    expect(computeStatus({ statusHint: "closed" }, TODAY)).toBe("closed");
    expect(computeStatus({ rolling: true }, TODAY)).toBe("rolling");
    expect(computeStatus({}, TODAY)).toBe("unknown");
  });
});

describe("normalizeOpportunity", () => {
  it("infers missing fields and produces a schema-valid record", () => {
    const rec = normalizeOpportunity(
      "test",
      { nativeId: "abc/1", title: "Women Founders Seed Grant", summary: "Equity-free grant up to ₹25 lakh for DPIIT-recognised startups at prototype stage.", url: "https://example.gov.in/x", country: "IN", amountMax: 2_500_000 },
      TODAY,
    );
    const parsed = OpportunitySchema.parse(rec);
    expect(parsed.id).toBe("test:abc-1");
    expect(parsed.fundingType).toBe("grant");
    expect(parsed.equityFree).toBe(true);
    expect(parsed.founderTypes).toContain("women");
    expect(parsed.registrations).toContain("dpiit");
    expect(parsed.stages).toContain("prototype");
    expect(parsed.states).toEqual(["pan-india"]);
  });
});

describe("extractPage", () => {
  it("pulls the official page's own facts", () => {
    const html = `<html><head><title>Seed Grant | State Startup Mission</title><meta name="description" content="Seed grant for early-stage startups registered in the state."></head>
      <body><nav>Home</nav><main><h1>Seed Grant</h1><p>Selected startups receive a grant of up to ₹10 lakh to build their prototype.</p>
      <p>The state fund has a corpus of ₹500 crore.</p><p>Last date for applications: 15 December 2026</p></main></body></html>`;
    const f = extractPage(html);
    expect(f.title).toBe("Seed Grant | State Startup Mission");
    expect(f.description).toMatch(/^Seed grant for early-stage/);
    expect(f.deadline).toBe("2026-12-15");
    expect(f.amount).toEqual({ min: null, max: 1_000_000, currency: "INR" });
    expect(f.mentionsIndia).toBe(true);
  });
});

describe("dedupe", () => {
  const base = OpportunitySchema.parse(
    normalizeOpportunity("myscheme", { nativeId: "sisfs", title: "Startup India Seed Fund Scheme", summary: "", url: "https://seedfund.startupindia.gov.in/", country: "IN", deadline: "2027-03-31" }, TODAY),
  );
  const curated = OpportunitySchema.parse(
    normalizeOpportunity("curated", { nativeId: "sisfs", title: "Startup India Seed Fund Scheme (SISFS)", summary: "Curated.", url: "https://seedfund.startupindia.gov.in", country: "IN" }, TODAY),
  );
  it("keeps the higher-priority record and fills its gaps", () => {
    const out = dedupe([base, curated], ["curated", "myscheme"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("curated");
    expect(out[0]!.alsoListedOn).toEqual(["myscheme"]);
    expect(out[0]!.deadline).toBe("2027-03-31");
  });
  it("does not merge different programs that share a portal URL", () => {
    const other = { ...base, id: "discovered:x", source: "discovered", title: "Kerala Innovation Grant", url: "https://seedfund.startupindia.gov.in/" };
    expect(dedupe([base, other], ["myscheme", "discovered"])).toHaveLength(2);
  });
});

describe("description hygiene", () => {
  it("rejects spam, boilerplate and fragments", async () => {
    const { usableDescription, isSpam, isErrorPage } = await import("../src/core/extract.js");
    expect(usableDescription("DRAGON222 merupakan link pilihan utama situs game online gacor hari ini")).toBe("");
    expect(usableDescription("Startup help desk No. 0522-4130303, Ext 302 Helpline for Technical Support")).toBe("");
    expect(usableDescription("Apply now")).toBe("");
    expect(usableDescription("Seed grant of up to ten lakh rupees for early-stage startups in the state.")).toMatch(/^Seed grant/);
    expect(isSpam("Slot online gacor")).toBe(true);
    expect(isErrorPage("404 - Page not found", 900)).toBe(true);
    expect(isErrorPage("Seed Fund | KSUM", 900)).toBe(false);
  });
});

describe("applicantAmountRange", () => {
  it("ignores corpus and outlay figures", async () => {
    const { applicantAmountRange } = await import("../src/core/money.js");
    expect(applicantAmountRange("The scheme has a corpus of ₹945 crore. Startups get up to ₹20 lakh as grant.")).toEqual({ min: null, max: 2_000_000, currency: "INR" });
  });
});
