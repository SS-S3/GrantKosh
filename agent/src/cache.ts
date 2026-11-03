// Answer cache. Many people open the advisor with the same first question ("grants for a hardware
// startup in Karnataka"); the answer to an identical opening question is stored and replayed, so it
// costs no model call and isn't held up when the advisor is busy. Only single-message chats that
// finished cleanly are stored. The key includes the model tier and the dataset date, so answers
// refresh with each day's data. Stored in Redis when configured (limits.ts), else in memory.
import { createHash } from "node:crypto";
import type { AgentEvent, ChatTurn } from "./agent";
import { withStore } from "./limits";

const TTL_S = Number(process.env.ADVISOR_CACHE_TTL_S ?? 6 * 3600);
const MAX_BYTES = 48 * 1024;

/** Case, spacing and trailing punctuation don't change the question. */
const normalize = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s?.!]+$/, "");

/** Cache key for this chat, or null when it can't be cached (a follow-up in a longer conversation). */
export function cacheKey(messages: ChatTurn[], tier: string, dataVersion: string): string | null {
  if (TTL_S <= 0 || messages.length !== 1) return null;
  const hash = createHash("sha256").update(JSON.stringify([tier, dataVersion, normalize(messages[0]!.content)])).digest("base64url");
  return `gk:ans:${hash}`;
}

export async function getCached(key: string): Promise<AgentEvent[] | null> {
  try {
    const raw = await withStore(s => s.getText(key));
    return raw ? (JSON.parse(raw) as AgentEvent[]) : null;
  } catch {
    return null;
  }
}

/** Stores a finished answer: its text, tool labels, matches and done event. Status lines are left out. */
export async function putCached(key: string, events: AgentEvent[]): Promise<void> {
  if (events.at(-1)?.type !== "done" || events.some(e => e.type === "error")) return;
  const kept: AgentEvent[] = [];
  for (const e of events) {
    if (e.type === "status") continue;
    const prev = kept.at(-1);
    // Merge text deltas so the stored answer is compact.
    if (e.type === "text" && prev?.type === "text") kept[kept.length - 1] = { type: "text", delta: prev.delta + e.delta };
    else kept.push(e);
  }
  const raw = JSON.stringify(kept);
  if (raw.length > MAX_BYTES) return;
  await withStore(s => s.setText(key, raw, TTL_S)).catch(() => {});
}
