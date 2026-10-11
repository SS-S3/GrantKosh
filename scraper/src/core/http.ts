// Polite HTTP client shared by every source.
//
// - Identifies itself honestly (GrantKoshBot user agent).
// - Obeys robots.txt for every origin it touches.
// - Rate-limits per host (concurrency + minimum gap between requests).
// - Retries transient failures with exponential backoff + jitter, honouring Retry-After.
// - Optional on-disk response cache so development re-runs don't hammer sources.
// - Can stream just the first N bytes of a page (used for discovery crawls).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import robotsParserModule from "robots-parser";
import { createLogger, type Logger } from "./log.js";

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
// robots-parser is CommonJS with an ESM-style default in its typings; normalise both shapes.
const robotsParser = ((robotsParserModule as unknown as { default?: unknown }).default ?? robotsParserModule) as (url: string, txt: string) => Robots;

export const BOT_NAME = "GrantKoshBot";
export const USER_AGENT = `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0; +https://github.com/grantkosh/grantkosh)`;

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly bodySnippet = "",
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export class RobotsDisallowedError extends Error {
  constructor(public readonly url: string) {
    super(`robots.txt disallows ${url}`);
  }
}

export interface HostPolicy {
  /** Max parallel requests to this host. */
  concurrency: number;
  /** Minimum milliseconds between request starts on this host. */
  minIntervalMs: number;
}

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  cacheDir?: string | null;
  /** Cache entries younger than this are served from disk. */
  cacheTtlMs?: number;
  defaultPolicy?: HostPolicy;
  hostPolicies?: Record<string, Partial<HostPolicy>>;
  /** Cap on simultaneous requests across all hosts. */
  globalConcurrency?: number;
  respectRobots?: boolean;
  logger?: Logger;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | FormData;
  /** Skip the disk cache for this request. */
  noCache?: boolean;
  /** Read at most this many bytes of the body, then hang up. */
  maxBytes?: number;
  /** Stop reading as soon as the decoded text so far contains this marker (checked after each chunk). */
  stopAfter?: string;
  timeoutMs?: number;
  /** Treat these statuses as success instead of throwing. */
  acceptStatus?: number[];
}

export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  text: string;
  fromCache: boolean;
  truncated: boolean;
}

interface HostState {
  active: number;
  lastStart: number;
  queue: Array<() => void>;
}

export interface HostStats {
  requests: number;
  cacheHits: number;
  bytes: number;
  retries: number;
  failures: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class HttpClient {
  private readonly opts: Required<Omit<HttpOptions, "logger" | "hostPolicies">> & { hostPolicies: Record<string, Partial<HostPolicy>> };
  private readonly log: Logger;
  private readonly hosts = new Map<string, HostState>();
  private readonly robots = new Map<string, Promise<Robots | null>>();
  private globalActive = 0;
  private readonly globalQueue: Array<() => void> = [];
  readonly stats = new Map<string, HostStats>();

  constructor(options: HttpOptions = {}) {
    this.opts = {
      timeoutMs: options.timeoutMs ?? 30_000,
      retries: options.retries ?? 3,
      cacheDir: options.cacheDir ?? null,
      cacheTtlMs: options.cacheTtlMs ?? 12 * 60 * 60 * 1000,
      defaultPolicy: options.defaultPolicy ?? { concurrency: 2, minIntervalMs: 750 },
      hostPolicies: options.hostPolicies ?? {},
      globalConcurrency: options.globalConcurrency ?? 12,
      respectRobots: options.respectRobots ?? true,
    };
    this.log = options.logger ?? createLogger("http");
  }

  async getText(url: string, req: RequestOptions = {}): Promise<HttpResponse> {
    return this.request(url, { ...req, method: "GET" });
  }

  async getJson<T = unknown>(url: string, req: RequestOptions = {}): Promise<T> {
    const res = await this.request(url, { ...req, method: "GET", headers: { Accept: "application/json", ...req.headers } });
    return parseJson<T>(res);
  }

  async postJson<T = unknown>(url: string, payload: unknown, req: RequestOptions = {}): Promise<T> {
    const res = await this.request(url, {
      ...req,
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", Accept: "application/json", ...req.headers },
    });
    return parseJson<T>(res);
  }

  async postForm(url: string, form: Record<string, string>, req: RequestOptions = {}): Promise<HttpResponse> {
    return this.request(url, {
      ...req,
      method: "POST",
      body: new URLSearchParams(form).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...req.headers },
    });
  }

  async request(url: string, req: RequestOptions = {}): Promise<HttpResponse> {
    const method = req.method ?? "GET";
    const host = new URL(url).host;
    const stats = this.statsFor(host);

    const cacheKey = this.cacheKey(method, url, req.body, req.maxBytes);
    if (!req.noCache) {
      const cached = await this.readCache(cacheKey);
      if (cached) {
        stats.cacheHits++;
        return cached;
      }
    }

    if (this.opts.respectRobots && !(await this.allowedByRobots(url))) throw new RobotsDisallowedError(url);

    let attempt = 0;
    for (;;) {
      try {
        const res = await this.withSlot(host, () => this.once(url, req));
        stats.requests++;
        stats.bytes += res.text.length;
        if (res.status >= 200 && res.status < 300) {
          if (!req.noCache) await this.writeCache(cacheKey, res);
          return res;
        }
        if (req.acceptStatus?.includes(res.status)) return res;
        if (RETRY_STATUS.has(res.status) && attempt < this.opts.retries) {
          const wait = retryAfterMs(res.headers["retry-after"]) ?? backoff(attempt);
          this.log.debug(`retry ${attempt + 1} in ${wait}ms after ${res.status}: ${url}`);
          stats.retries++;
          attempt++;
          await sleep(wait);
          continue;
        }
        stats.failures++;
        throw new HttpError(res.status, url, res.text.slice(0, 300));
      } catch (err) {
        if (err instanceof HttpError || err instanceof RobotsDisallowedError) throw err;
        if (attempt < this.opts.retries) {
          const wait = backoff(attempt);
          this.log.debug(`retry ${attempt + 1} in ${wait}ms after ${(err as Error).message}: ${url}`);
          stats.retries++;
          attempt++;
          await sleep(wait);
          continue;
        }
        stats.failures++;
        throw err;
      }
    }
  }

  private async once(url: string, req: RequestOptions): Promise<HttpResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${req.timeoutMs ?? this.opts.timeoutMs}ms`)), req.timeoutMs ?? this.opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: req.method ?? "GET",
        body: req.body,
        redirect: "follow",
        signal: ctrl.signal,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-IN,en;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          ...req.headers,
        },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const { text, truncated } = await readBody(res, req.maxBytes, req.stopAfter);
      return { url: res.url || url, status: res.status, headers, text, fromCache: false, truncated };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- rate limiting ----------

  private policyFor(host: string): HostPolicy {
    return { ...this.opts.defaultPolicy, ...this.opts.hostPolicies[host] };
  }

  private async withSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
    await this.acquireGlobal();
    try {
      await this.acquireHost(host);
      try {
        return await fn();
      } finally {
        this.releaseHost(host);
      }
    } finally {
      this.releaseGlobal();
    }
  }

  private acquireGlobal(): Promise<void> {
    if (this.globalActive < this.opts.globalConcurrency) {
      this.globalActive++;
      return Promise.resolve();
    }
    // A released slot is handed straight to the next waiter, so the count never overshoots.
    return new Promise(resolve => this.globalQueue.push(resolve));
  }

  private releaseGlobal() {
    const next = this.globalQueue.shift();
    if (next) next();
    else this.globalActive--;
  }

  private async acquireHost(host: string): Promise<void> {
    let st = this.hosts.get(host);
    if (!st) this.hosts.set(host, (st = { active: 0, lastStart: 0, queue: [] }));
    const policy = this.policyFor(host);
    if (st.active < policy.concurrency) st.active++;
    else await new Promise<void>(resolve => st!.queue.push(resolve));
    // Space out request starts. Reserve our start time before sleeping so parallel waiters queue up behind us.
    const now = Date.now();
    const startAt = Math.max(now, st.lastStart + policy.minIntervalMs);
    st.lastStart = startAt;
    if (startAt > now) await sleep(startAt - now);
  }

  private releaseHost(host: string) {
    const st = this.hosts.get(host)!;
    const next = st.queue.shift();
    if (next) next();
    else st.active--;
  }

  private statsFor(host: string): HostStats {
    let s = this.stats.get(host);
    if (!s) this.stats.set(host, (s = { requests: 0, cacheHits: 0, bytes: 0, retries: 0, failures: 0 }));
    return s;
  }

  // ---------- robots.txt ----------

  async allowedByRobots(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    let p = this.robots.get(origin);
    if (!p) {
      p = this.loadRobots(origin);
      this.robots.set(origin, p);
    }
    const robots = await p;
    if (!robots) return true;
    return robots.isAllowed(url, BOT_NAME) !== false;
  }

  private async loadRobots(origin: string) {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await this.withSlot(new URL(origin).host, () => this.once(robotsUrl, { timeoutMs: 15_000, maxBytes: 512_000 }));
      // Only a real text file counts. Some government servers answer /robots.txt with an HTML error page.
      const type = res.headers["content-type"] ?? "";
      if (res.status >= 400 || /html/i.test(type) || /^\s*</.test(res.text)) return null;
      return robotsParser(robotsUrl, res.text);
    } catch (err) {
      this.log.debug(`robots.txt unavailable for ${origin}: ${(err as Error).message}`);
      return null;
    }
  }

  // ---------- disk cache ----------

  private cacheKey(method: string, url: string, body: unknown, maxBytes?: number) {
    const b = typeof body === "string" ? body : "";
    return createHash("sha1").update(`${method} ${url} ${b} ${maxBytes ?? ""}`).digest("hex");
  }

  private async readCache(key: string): Promise<HttpResponse | null> {
    if (!this.opts.cacheDir) return null;
    try {
      const raw = JSON.parse(await readFile(join(this.opts.cacheDir, key.slice(0, 2), key + ".json"), "utf8"));
      if (Date.now() - raw.savedAt > this.opts.cacheTtlMs) return null;
      return { ...raw.response, fromCache: true };
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, response: HttpResponse) {
    if (!this.opts.cacheDir) return;
    const dir = join(this.opts.cacheDir, key.slice(0, 2));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key + ".json"), JSON.stringify({ savedAt: Date.now(), response }));
  }
}

async function readBody(res: Response, maxBytes?: number, stopAfter?: string): Promise<{ text: string; truncated: boolean }> {
  if (!maxBytes && !stopAfter) return { text: await res.text(), truncated: false };
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), truncated: false };
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if ((maxBytes && bytes >= maxBytes) || (stopAfter && text.includes(stopAfter))) {
      await reader.cancel().catch(() => {});
      return { text, truncated: true };
    }
  }
}

function parseJson<T>(res: HttpResponse): T {
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new Error(`Expected JSON from ${res.url}, got: ${res.text.slice(0, 120).replace(/\s+/g, " ")}`);
  }
}

export function backoff(attempt: number): number {
  const base = 1000 * 2 ** attempt;
  return Math.min(30_000, base + Math.floor(Math.random() * base * 0.5));
}

export function retryAfterMs(header: string | undefined): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(60_000, Math.max(0, secs * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(60_000, Math.max(0, at - Date.now())) : null;
}
