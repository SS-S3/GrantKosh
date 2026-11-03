import { describe, expect, it } from "vitest";
import type { Investor, Opportunity } from "../../web/src/types";
import { buildDataset, publicId } from "../src/data";
import { funding, investors, match, MatchBody, opportunity, stats } from "../src/directory";

const TODAY = "2026-11-03";
const opp = (id: string, over: Partial<Opportunity>): Opportunity => ({
  id, source: id.split(":")[0]!, alsoListedOn: ["other"], title: id, provider: "", summary: "", url: "https://example.gov.in/x", applyUrl: null,
  programType: "grant", fundingType: "grant", equityFree: true, amountMin: null, amountMax: null, currency: null, amountMaxInr: null,
  opensAt: null, deadline: null, rolling: false, status: "rolling", country: "IN", states: ["pan-india"], sectors: [], stages: [],
  founderTypes: [], registrations: [], entityTypes: [], eligibility: [], tags: [], cadence: null, verified: false, lastVerified: null,
  confidence: "medium", firstSeen: TODAY, lastSeen: TODAY, ...over,
});
const OPPS = Array.from({ length: 45 }, (_, i) => opp(`myscheme:${i}`, { title: `Scheme ${i}`, sectors: i % 3 ? ["agritech"] : ["drones"] }));
const INV = [{ id: "sebi-aif:1", source: "sebi-aif", sourceUrl: "https://www.sebi.gov.in/x", name: "Alpha Ventures", kind: "venture-capital", category: "AIF Category I", registrationNo: "IN/AIF1/1", email: null, website: null, city: "Pune", state: "Maharashtra", country: "IN", registeredOn: "2020-01-01", validUntil: null, tags: [], firstSeen: TODAY, lastSeen: TODAY }] as unknown as Investor[];
const ds = buildDataset(OPPS, INV, "2026-11-03T00:00:00Z", TODAY);

describe("directory API", () => {
  it("pages results and never sends source fields", () => {
    const first = funding(ds, new URLSearchParams("sector=drones"));
    expect(first.total).toBe(15);
    expect(first.items).toHaveLength(15);
    const all = funding(ds, new URLSearchParams("limit=500"));
    expect(all.items).toHaveLength(45); // limit is capped at 50 per page
    const page2 = funding(ds, new URLSearchParams("offset=30"));
    expect(page2.items).toHaveLength(15);
    for (const o of first.items) {
      expect(o).not.toHaveProperty("source");
      expect(o).not.toHaveProperty("alsoListedOn");
      expect(o.id).not.toContain("myscheme");
    }
    expect(first.counts.sector).toContainEqual(["agritech", 30]);
  });

  it("looks up one programme by its opaque id only", () => {
    expect(opportunity(ds, publicId("myscheme:3"))?.title).toBe("Scheme 3");
    expect(opportunity(ds, "myscheme:3")).toBeNull();
  });

  it("hides the investor register's source", () => {
    const page = investors(ds, new URLSearchParams("q=alpha"));
    expect(page.total).toBe(1);
    expect(page.items[0]).not.toHaveProperty("sourceUrl");
    expect(page.items[0]).not.toHaveProperty("source");
  });

  it("ranks guided matches and reports counts", () => {
    const items = match(ds, MatchBody.parse({ profile: { sectors: ["drones"] } }));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.program.sectors).toContain("drones");
    expect(stats(ds)).toMatchObject({ programs: 45, investors: 1, today: TODAY });
  });
});
