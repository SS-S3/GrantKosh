// The directory lives on the server: the browser asks the API for one page at a time and never
// downloads the dataset (see agent/src/directory.ts).
import type { Investor, Opportunity } from "./types";

/** A programme as the API sends it: without the fields that say where it came from. */
export type PublicOpportunity = Omit<Opportunity, "source" | "alsoListedOn">;
export type PublicInvestor = Omit<Investor, "source" | "sourceUrl">;

export interface Stats {
  programs: number;
  openNow: number;
  investors: number;
  generatedAt: string;
  /** Today in India, which the server used for statuses and deadlines. */
  today: string;
}

export interface Page<T, K extends string> {
  total: number;
  offset: number;
  items: T[];
  counts: Record<K, Array<[string, number]>>;
  /** True when a text search is applied (so "Best match" sorting is available). */
  searching: boolean;
  sort?: string;
}

export interface MatchResult {
  program: PublicOpportunity;
  score: number;
  reasons: string[];
  cautions: string[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`api/${path}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Couldn't load the directory (HTTP ${res.status}).`, res.status);
  return body;
}

export const loadStats = () => api<Stats>("stats");
export const loadOpportunity = (id: string) => api<PublicOpportunity>(`opportunity?id=${encodeURIComponent(id)}`);
