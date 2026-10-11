import { ApiError, type GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { rankPrograms, scoreProgram } from "../../web/src/match";
import type { Opportunity } from "../../web/src/types";
import { type AgentEvent, errorEvent, runAdvisor } from "../src/agent";
import { buildDataset } from "../src/data";
import { findPrograms, runTool } from "../src/tools";

const TODAY = "2026-10-08";

function opp(id: string, over: Partial<Opportunity>): Opportunity {
  return {
    id, source: id.split(":")[0]!, alsoListedOn: [], title: id, provider: "", summary: "", url: "https://example.gov.in/" + id.replace(":", "-"),
    applyUrl: null, programType: "grant", fundingType: "grant", equityFree: true, amountMin: null, amountMax: null, currency: null,
    amountMaxInr: null, opensAt: null, deadline: null, rolling: false, status: "rolling", country: "IN", states: ["pan-india"],
    sectors: [], stages: [], founderTypes: [], registrations: [], entityTypes: [], eligibility: [], tags: [], cadence: null,
    verified: false, lastVerified: null, confidence: "medium", firstSeen: TODAY, lastSeen: TODAY, ...over,
  };
}

const DATA = [
  opp("curated:idex-disc", { title: "iDEX — Defence India Startup Challenge (DISC)", provider: "iDEX-DIO, Ministry of Defence", sectors: ["defence", "drones", "ai"], stages: ["prototype", "early-revenue"], amountMax: 15_000_000, amountMaxInr: 15_000_000, currency: "INR", verified: true, confidence: "high", status: "unknown" }),
  opp("curated:nidhi-prayas", { title: "NIDHI-PRAYAS", provider: "DST via TBIs", sectors: ["any"], stages: ["idea", "prototype"], amountMax: 1_000_000, amountMaxInr: 1_000_000, currency: "INR", verified: true, confidence: "high", status: "unknown" }),
  opp("myscheme:ka-elevate", { title: "Karnataka Elevate", states: ["karnataka"], sectors: ["any"] }),
  opp("myscheme:women-only", { title: "Women Entrepreneur Seed Grant", founderTypes: ["women"], sectors: ["any"] }),
  opp("myscheme:dpiit-only", { title: "Seed Fund for Recognised Startups", registrations: ["dpiit"], sectors: ["any"] }),
  opp("discovered:closed-drone", { title: "Drone Hackathon", sectors: ["drones"], status: "closed", deadline: "2026-01-01" }),
  opp("eu-funding:123", { title: "EIC Pathfinder", country: "EU", states: [], sectors: ["deeptech"] }),
  opp("myscheme:textiles", { title: "Handloom Weavers Subsidy", sectors: ["textiles"], programType: "subsidy", fundingType: "subsidy" }),
];

describe("matcher", () => {
  it("puts iDEX first for a defence drone prototype", () => {
    const top = rankPrograms(DATA, { sectors: ["defence", "drones"], stage: "prototype" }, TODAY);
    expect(top[0]!.program.id).toBe("curated:idex-disc");
    expect(top[0]!.reasons.join(" ")).toMatch(/Flagship: iDEX/);
  });

  it("surfaces NIDHI for an idea-stage founder in any sector", () => {
    const top = rankPrograms(DATA, { sectors: ["edtech"], stage: "idea" }, TODAY);
    expect(top.map(m => m.program.id).slice(0, 2)).toContain("curated:nidhi-prayas");
  });

  it("hides other states' programmes, closed calls and foreign programmes by default", () => {
    const ids = rankPrograms(DATA, { sectors: ["drones"] }, TODAY, null, 50).map(m => m.program.id);
    expect(ids).not.toContain("myscheme:ka-elevate");
    expect(ids).not.toContain("discovered:closed-drone");
    expect(ids).not.toContain("eu-funding:123");
    expect(rankPrograms(DATA, { state: "karnataka" }, TODAY, null, 50).map(m => m.program.id)).toContain("myscheme:ka-elevate");
    expect(rankPrograms(DATA, { international: true }, TODAY, null, 50).map(m => m.program.id)).toContain("eu-funding:123");
  });

  it("penalises programmes reserved for groups the founder isn't in, and flags DPIIT", () => {
    const women = scoreProgram(DATA[3]!, {}, TODAY)!;
    expect(women.cautions.join()).toMatch(/women/);
    expect(scoreProgram(DATA[3]!, { founderTypes: ["women"] }, TODAY)!.score).toBeGreaterThan(women.score);
    expect(scoreProgram(DATA[4]!, { dpiit: false }, TODAY)!.cautions).toContain("Needs DPIIT recognition");
  });

  it("drops equity programmes for founders who want non-dilutive money only", () => {
    const eq = opp("x:fund", { fundingType: "equity", equityFree: false });
    expect(scoreProgram(eq, { equityOk: false }, TODAY)).toBeNull();
  });
});

describe("tools", () => {
  const ds = buildDataset(DATA, [], "2026-10-08T00:00:00Z", TODAY);
  it("find_programs ranks, explains and returns compact records", () => {
    const out = findPrograms(ds, { query: "iDEX", sectors: ["defence"], stage: "prototype" }, TODAY);
    const results = out.content.results as Array<{ id: string; why: string[] }>;
    expect(results[0]!.id).toBe("curated:idex-disc");
    expect(results[0]!.why.length).toBeGreaterThan(0);
    expect(out.label).toMatch(/Searched 8 programmes/);
  });
  it("falls back to profile ranking when a query-only search matches nothing", () => {
    const out = findPrograms(ds, { query: "zzqqxx" }, TODAY);
    expect(out.content.note).toMatch(/No programme text matched/);
    expect((out.content.results as unknown[]).length).toBeGreaterThan(0);
  });
  it("uses the query as a boost, not a filter, when profile facts are given", () => {
    const out = findPrograms(ds, { query: "zzqqxx", stage: "idea" }, TODAY);
    expect(out.content.note).toBeUndefined();
    expect((out.content.results as Array<{ id: string }>).map(r => r.id)).toContain("curated:nidhi-prayas");
  });
  it("rejects invalid model arguments instead of running them", () => {
    const out = runTool(ds, "find_programs", { stage: "series-z" });
    expect(out.isError).toBe(true);
    expect(String(out.content.error)).toMatch(/INVALID_INPUT/);
    expect(runTool(ds, "get_program", { id: "nope:1" }).isError).toBe(true);
  });
});

// ---------- agent loop against a scripted fake Gemini ----------

type Chunk = { candidates: Array<{ content: { parts: Array<Record<string, unknown>> }; finishReason?: string }> };

function fakeAi(script: Array<Chunk[] | Error>, calls: unknown[] = []): GoogleGenAI {
  let i = 0;
  return {
    models: {
      generateContentStream: async (params: unknown) => {
        calls.push(structuredClone(params));
        const next = script[i++];
        if (next instanceof Error) throw next;
        return (async function* () {
          for (const c of next!) yield c;
        })();
      },
    },
  } as unknown as GoogleGenAI;
}

describe("runAdvisor", () => {
  const ds = buildDataset(DATA, [], "2026-10-08T00:00:00Z", TODAY);

  it("calls tools, replays thought signatures and streams the final answer", async () => {
    const calls: Array<{ model: string; contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }> = [];
    const ai = fakeAi(
      [
        [{ candidates: [{ content: { parts: [{ functionCall: { id: "c1", name: "find_programs", args: { sectors: ["defence"], stage: "prototype" } }, thoughtSignature: "SIG1" }] } }] }],
        [
          { candidates: [{ content: { parts: [{ text: "Best fit: **iDEX DISC** " }] } }] },
          { candidates: [{ content: { parts: [{ text: "[[curated:idex-disc]]" }] }, finishReason: "STOP" }] },
        ],
      ],
      calls as unknown[],
    );
    const events: AgentEvent[] = [];
    await runAdvisor([{ role: "user", content: "Defence drone startup, prototype stage" }], e => events.push(e), { ai, models: ["m1"], dataset: ds });

    const text = events.filter(e => e.type === "text").map(e => (e as { delta: string }).delta).join("");
    expect(text).toBe("Best fit: **iDEX DISC** [[curated:idex-disc]]");
    expect(events.some(e => e.type === "tool")).toBe(true);
    const matches = events.find(e => e.type === "matches") as { items: Array<{ id: string }> };
    expect(matches.items[0]!.id).toBe("curated:idex-disc");
    expect(events.at(-1)).toEqual({ type: "done", model: "m1" });

    // Second request carries the model turn verbatim (with its signature) and the function response.
    const second = calls[1]!.contents;
    expect(second[1]!.role).toBe("model");
    expect(second[1]!.parts[0]!.thoughtSignature).toBe("SIG1");
    expect((second[2]!.parts[0]!.functionResponse as { id: string; name: string }).name).toBe("find_programs");
    expect((second[2]!.parts[0]!.functionResponse as { id: string }).id).toBe("c1");
  });

  it("falls back to the next model when the first is rate-limited", async () => {
    const calls: Array<{ model: string }> = [];
    const ai = fakeAi([new ApiError({ message: "quota", status: 429 }), [{ candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }] }]], calls as unknown[]);
    const events: AgentEvent[] = [];
    await runAdvisor([{ role: "user", content: "hello" }], e => events.push(e), { ai, models: ["m1", "m2"], dataset: ds });
    expect(calls.map(c => c.model)).toEqual(["m1", "m2"]);
    expect(events.at(-1)).toEqual({ type: "done", model: "m2" });
  });

  it("forbids tool calls on the final step so the loop always ends with an answer", async () => {
    const callTurn: Chunk[] = [{ candidates: [{ content: { parts: [{ functionCall: { name: "find_programs", args: {} } }] } }] }];
    const calls: Array<{ config: { toolConfig: { functionCallingConfig: { mode: string } } } }> = [];
    const ai = fakeAi([callTurn, callTurn, callTurn, callTurn, [{ candidates: [{ content: { parts: [{ text: "done" }] } }] }]], calls as unknown[]);
    await runAdvisor([{ role: "user", content: "x" }], () => {}, { ai, models: ["m1"], dataset: ds });
    expect(calls).toHaveLength(5);
    expect(calls[4]!.config.toolConfig.functionCallingConfig.mode).toBe("NONE");
    expect(calls[0]!.config.toolConfig.functionCallingConfig.mode).toBe("AUTO");
  });

  it("reports safety blocks and quota errors in plain language", async () => {
    const ai = fakeAi([[{ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }]]);
    const events: AgentEvent[] = [];
    await runAdvisor([{ role: "user", content: "x" }], e => events.push(e), { ai, models: ["m1"], dataset: ds });
    expect(events.at(-1)).toMatchObject({ type: "error", code: "blocked" });
    expect(errorEvent(new ApiError({ message: "q", status: 429 }))).toMatchObject({ code: "quota" });
  });
});
