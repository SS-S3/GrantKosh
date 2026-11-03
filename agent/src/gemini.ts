// Gemini API keys. GEMINI_API_KEYS takes a comma-separated list (GEMINI_API_KEY still works for one).
// Requests start on the keys in turn, so load spreads evenly; a key that answers 429 (quota), 5xx or
// "invalid key" rests for a while and the request moves to the next key before falling back to the
// next model. Keys from separate Google Cloud projects have separate quotas and billing; keys from one
// project share one quota, so they only add failover.
import type { GoogleGenAI } from "@google/genai";

export interface GeminiClient {
  /** 1-based position in GEMINI_API_KEYS, for logs. Never the key itself. */
  id: number;
  ai: GoogleGenAI;
}

export class KeyPool {
  private next = 0;
  private restingUntil = new Map<number, number>();

  constructor(readonly clients: GeminiClient[]) {}

  get size() {
    return this.clients.length;
  }

  /** Every key, starting with the next in turn; resting keys go last, in case all are resting. */
  order(now = Date.now()): GeminiClient[] {
    const start = this.next++ % this.clients.length;
    const turn = [...this.clients.slice(start), ...this.clients.slice(0, start)];
    const ready = turn.filter(c => (this.restingUntil.get(c.id) ?? 0) <= now);
    return [...ready, ...turn.filter(c => !ready.includes(c))];
  }

  rest(id: number, ms: number, now = Date.now()) {
    this.restingUntil.set(id, now + ms);
  }
}

export function apiKeys(env = process.env): string[] {
  const list = env.GEMINI_API_KEYS ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "";
  return [...new Set(list.split(",").map(s => s.trim()).filter(Boolean))];
}
