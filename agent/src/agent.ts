// GrantKosh Advisor: a narrow funding-matchmaker agent on the Gemini API (free tier friendly).
//
// Loop: stream a model turn → run any function calls against the local dataset → feed results
// back → repeat (max MAX_STEPS) → final answer. The model's parts are appended back verbatim so
// Gemini's thought signatures survive between steps, which function calling requires.
import {
  ApiError, type Content, type FunctionCall, FunctionCallingConfigMode, type GenerateContentConfig, type GenerateContentResponse, type GoogleGenAI, type Part, ThinkingLevel,
} from "@google/genai";
import type { Match } from "../../web/src/match";
import type { Dataset } from "./data";
import { SYSTEM_PROMPT } from "./prompt";
import { runTool, TOOLS } from "./tools";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface MatchSummary {
  id: string;
  score: number;
  reasons: string[];
  cautions: string[];
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool"; label: string }
  | { type: "matches"; items: MatchSummary[] }
  | { type: "done"; model: string }
  | { type: "error"; message: string; code: "quota" | "blocked" | "unavailable" | "internal" };

export interface AgentOptions {
  ai: GoogleGenAI;
  /** Tried in order; later ones are used when an earlier one is rate-limited or unavailable. */
  models: string[];
  dataset: Dataset;
  signal?: AbortSignal;
}

const MAX_STEPS = 5;
const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

function configFor(model: string, finalStep: boolean): GenerateContentConfig {
  return {
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOLS }],
    // On the last step the model must answer with what it already has.
    toolConfig: { functionCallingConfig: { mode: finalStep ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
    temperature: 0.3,
    maxOutputTokens: 4096,
    // Light thinking keeps answers grounded without burning the free-tier token budget.
    thinkingConfig: model.startsWith("gemini-2.5") ? { thinkingBudget: 512 } : { thinkingLevel: ThinkingLevel.LOW },
  };
}

/** Errors worth retrying on the next model: quota/rate limits, overload, unknown model. */
function isFallbackError(err: unknown): boolean {
  return err instanceof ApiError && [404, 429, 500, 503].includes(err.status);
}

export async function runAdvisor(history: ChatTurn[], emit: (e: AgentEvent) => void, opts: AgentOptions): Promise<void> {
  const contents: Content[] = history.map(t => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
  const seen = new Map<string, Match>();
  let modelIndex = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const finalStep = step === MAX_STEPS - 1;
    let stream: AsyncGenerator<GenerateContentResponse>;
    // Pick a model. Fallback is allowed only on the first step: thought signatures from one
    // model must not be replayed to another.
    for (;;) {
      const model = opts.models[modelIndex]!;
      try {
        stream = await opts.ai.models.generateContentStream({ model, contents, config: { ...configFor(model, finalStep), abortSignal: opts.signal } });
        break;
      } catch (err) {
        if (step === 0 && isFallbackError(err) && modelIndex < opts.models.length - 1) {
          modelIndex++;
          emit({ type: "status", text: "Primary model busy, switching…" });
          continue;
        }
        throw err;
      }
    }

    const modelParts: Part[] = [];
    const calls: FunctionCall[] = [];
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finishReason = cand.finishReason;
      for (const part of cand?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.thought) continue;
        if (part.text) emit({ type: "text", delta: part.text });
        if (part.functionCall) calls.push(part.functionCall);
      }
      if (chunk.promptFeedback?.blockReason) finishReason = chunk.promptFeedback.blockReason;
    }

    if (finishReason && BLOCKED.has(finishReason)) {
      emit({ type: "error", code: "blocked", message: "That request was blocked by the model's safety filters. Try rephrasing it as a question about funding for your startup." });
      return;
    }
    contents.push({ role: "model", parts: modelParts });
    if (!calls.length) break;

    const responses: Part[] = [];
    for (const call of calls) {
      const outcome = runTool(opts.dataset, call.name ?? "", call.args ?? {});
      emit({ type: "tool", label: outcome.label });
      for (const m of outcome.matches ?? []) if (!seen.has(m.program.id) || seen.get(m.program.id)!.score < m.score) seen.set(m.program.id, m);
      responses.push({ functionResponse: { id: call.id, name: call.name, response: outcome.isError ? { error: outcome.content.error } : outcome.content } });
    }
    contents.push({ role: "user", parts: responses });
    if (seen.size) {
      emit({
        type: "matches",
        items: [...seen.values()].sort((a, b) => b.score - a.score).map(m => ({ id: m.program.id, score: Math.round(m.score), reasons: m.reasons, cautions: m.cautions })),
      });
    }
  }
  emit({ type: "done", model: opts.models[modelIndex]! });
}

/** Map any failure to a user-facing event. Quota errors tell the UI to offer guided mode. */
export function errorEvent(err: unknown): AgentEvent {
  if (err instanceof ApiError) {
    // A rejected key is an operator problem; tell the UI to fall back rather than retry.
    if (err.status === 401 || err.status === 403 || (err.status === 400 && /API_KEY_INVALID|API key not valid/.test(err.message))) {
      return { type: "error", code: "unavailable", message: "The AI advisor isn't available right now. Guided matching still works." };
    }
    if (err.status === 429) return { type: "error", code: "quota", message: "The free AI quota is used up for now. Use guided matching below, or try again in a minute." };
    if (err.status >= 500 || err.status === 404) return { type: "error", code: "unavailable", message: "The AI service is unavailable right now. Guided matching still works." };
  }
  if ((err as Error)?.name === "AbortError") return { type: "error", code: "internal", message: "Request cancelled." };
  return { type: "error", code: "internal", message: "Something went wrong while answering. Please try again." };
}

