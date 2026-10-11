// Development stand-in for Gemini (ADVISOR_MOCK=1): drives the real agent loop and real tools with a
// scripted model, so the streaming UI can be built and tested without an API key or quota.
import type { GoogleGenAI } from "@google/genai";

type Part = { text?: string; functionCall?: { id: string; name: string; args: unknown }; functionResponse?: { response?: { results?: Array<{ id: string; title: string; funding: string; why: string[] }> } } };
type Content = { role: string; parts: Part[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function mockAi(): GoogleGenAI {
  return {
    models: {
      generateContentStream: async ({ contents }: { contents: Content[] }) => {
        const last = contents[contents.length - 1]!;
        const toolResults = last.parts.find(p => p.functionResponse)?.functionResponse?.response?.results;
        return (async function* () {
          if (!toolResults) {
            const ask = last.parts.map(p => p.text ?? "").join(" ").slice(0, 200);
            yield { candidates: [{ content: { parts: [{ functionCall: { id: "mock-1", name: "find_programs", args: { query: ask, limit: 6 } } }] } }] };
            return;
          }
          const lines = [
            "(Mock advisor: set GEMINI_API_KEY for real answers.) Based on what you described, here is what fits:\n\n**Best fits**\n",
            ...toolResults.slice(0, 4).map(r => `- **${r.title}** [[${r.id}]]: ${r.why.slice(0, 2).join("; ") || "relevant to your query"}. Funding: ${r.funding}.\n`),
            "\nWhich state are you registered in, and do you have DPIIT recognition?",
          ];
          for (const l of lines) {
            await sleep(120);
            yield { candidates: [{ content: { parts: [{ text: l }] } }] };
          }
          yield { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] };
        })();
      },
    },
  } as unknown as GoogleGenAI;
}
