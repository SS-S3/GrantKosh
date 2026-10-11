import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpClient, HttpError, RobotsDisallowedError, retryAfterMs } from "../src/core/http.js";

let server: Server;
let base: string;
const hits = new Map<string, number>();
const starts: number[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === "/robots.txt") return res.end("User-agent: *\nDisallow: /private\n");
    if (path === "/flaky") {
      if (hits.get(path)! < 3) return (res.statusCode = 503), res.end("busy");
      return res.end("ok");
    }
    if (path === "/limited") {
      if (hits.get(path)! < 2) return res.writeHead(429, { "Retry-After": "0" }).end();
      return res.end("ok");
    }
    if (path === "/missing") return (res.statusCode = 404), res.end("nope");
    if (path.startsWith("/slow")) {
      starts.push(Date.now());
      return setTimeout(() => res.end("done"), 20);
    }
    if (path === "/big") {
      res.write("<head>" + "x".repeat(50_000) + "MARKER");
      // Never ends on its own: the client must hang up after the marker.
      return;
    }
    res.end("hello");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const client = (extra = {}) => new HttpClient({ retries: 3, defaultPolicy: { concurrency: 4, minIntervalMs: 0 }, ...extra });

describe("HttpClient", () => {
  it("respects robots.txt", async () => {
    const http = client();
    await expect(http.getText(`${base}/private/page`)).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect((await http.getText(`${base}/public`)).text).toBe("hello");
  });

  it("retries 5xx with backoff until success", async () => {
    const res = await client().getText(`${base}/flaky`);
    expect(res.text).toBe("ok");
    expect(hits.get("/flaky")).toBe(3);
  }, 15_000);

  it("honours Retry-After on 429", async () => {
    const res = await client().getText(`${base}/limited`);
    expect(res.text).toBe("ok");
  });

  it("does not retry 404 and throws HttpError", async () => {
    await expect(client().getText(`${base}/missing`)).rejects.toBeInstanceOf(HttpError);
    expect(hits.get("/missing")).toBe(1);
  });

  it("returns accepted error statuses instead of throwing", async () => {
    expect((await client().getText(`${base}/missing`, { acceptStatus: [404] })).status).toBe(404);
  });

  it("spaces out requests to the same host", async () => {
    // Measure when the client *starts* each request; server arrival times include connection jitter.
    const clientStarts: number[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/slow")) clientStarts.push(performance.now());
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const http = client({ defaultPolicy: { concurrency: 1, minIntervalMs: 60 } });
      await Promise.all([1, 2, 3, 4].map(i => http.getText(`${base}/slow${i}`)));
    } finally {
      globalThis.fetch = realFetch;
    }
    const gaps = clientStarts.slice(1).map((t, i) => t - clientStarts[i]!);
    expect(gaps).toHaveLength(3);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(58);
  });

  it("stops reading once the marker arrives", async () => {
    const res = await client().getText(`${base}/big`, { stopAfter: "MARKER", timeoutMs: 3000 });
    expect(res.truncated).toBe(true);
    expect(res.text.endsWith("MARKER")).toBe(true);
  });

  it("parses Retry-After in seconds and dates", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
  });
});
