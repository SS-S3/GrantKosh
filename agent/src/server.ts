// GrantKosh Advisor server: streams Gemini answers over Server-Sent Events and serves the built UI.
//   GET  /api/health  → { ai, models, dataGeneratedAt }
//   POST /api/chat    → text/event-stream of AgentEvent JSON lines
// Configure with agent/.env (see .env.example). Without GEMINI_API_KEY the UI uses guided mode.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { type AgentEvent, errorEvent, runAdvisor } from "./agent";
import { getDataset } from "./data";
import { mockAi } from "./mock";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const PORT = Number(process.env.PORT ?? 8787);
const API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
const MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-2.5-flash").split(",").map(s => s.trim()).filter(Boolean);
/** Per-IP requests allowed per window, and a whole-server daily cap to stay inside the free quota. */
const PER_IP_LIMIT = Number(process.env.ADVISOR_PER_IP_LIMIT ?? 12);
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const DAILY_LIMIT = Number(process.env.ADVISOR_DAILY_LIMIT ?? 400);
const WEB_DIST = resolve(fileURLToPath(new URL("../../web/dist/", import.meta.url)));

const MOCK = process.env.ADVISOR_MOCK === "1";
const ai = MOCK ? mockAi() : API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) }))
    .min(1)
    .max(24)
    .refine(m => m[m.length - 1]!.role === "user", "last message must be from the user")
    .refine(m => m[m.length - 1]!.content.length <= 2000, "message too long (max 2000 characters)"),
});

// ---------- rate limiting ----------
const hits = new Map<string, number[]>();
let day = new Date().toDateString();
let dayCount = 0;

function allow(ip: string): "ok" | "ip" | "daily" {
  const today = new Date().toDateString();
  if (today !== day) {
    day = today;
    dayCount = 0;
    hits.clear();
  }
  if (dayCount >= DAILY_LIMIT) return "daily";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < PER_IP_WINDOW_MS);
  if (recent.length >= PER_IP_LIMIT) return "ip";
  recent.push(now);
  hits.set(ip, recent);
  dayCount++;
  return "ok";
}

const clientIp = (req: IncomingMessage) =>
  (process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() : "") || req.socket.remoteAddress || "unknown";

// ---------- helpers ----------
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

/** Long cache for content-hashed assets, an hour for the daily data files, revalidate everything else. */
function cacheControl(file: string): string {
  if (file.includes(`${sep}assets${sep}`)) return "public, max-age=31536000, immutable";
  if (file.includes(`${sep}data${sep}`)) return "public, max-age=3600, stale-while-revalidate=86400";
  return "no-cache";
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (!existsSync(WEB_DIST)) return json(res, 404, { error: "UI not built. Run `npm run build` (or use `npm run dev` for development)." });
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    return json(res, 400, { error: "bad path" });
  }
  let file = normalize(join(WEB_DIST, urlPath));
  if (file !== WEB_DIST && !file.startsWith(WEB_DIST + sep)) return json(res, 403, { error: "forbidden" });
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Unknown asset/data paths are real 404s; anything else is a client-side route → index.html.
    if (/^\/(assets|data)\//.test(urlPath)) return json(res, 404, { error: "not found" });
    file = join(WEB_DIST, "index.html");
  }

  // Serve the precompressed variant written by scripts/compress.mjs when the client accepts it.
  const accept = String(req.headers["accept-encoding"] ?? "");
  let body = file;
  let encoding: string | undefined;
  if (/\bbr\b/.test(accept) && existsSync(`${file}.br`)) (body = `${file}.br`), (encoding = "br");
  else if (/\bgzip\b/.test(accept) && existsSync(`${file}.gz`)) (body = `${file}.gz`), (encoding = "gzip");

  const stat = statSync(body);
  const headers: Record<string, string | number> = {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": cacheControl(file),
    "Content-Length": stat.size,
    "Last-Modified": stat.mtime.toUTCString(),
    Vary: "Accept-Encoding",
  };
  if (encoding) headers["Content-Encoding"] = encoding;
  const since = req.headers["if-modified-since"];
  if (since && Date.parse(since) >= Math.floor(stat.mtimeMs / 1000) * 1000) {
    res.writeHead(304, { "Cache-Control": headers["Cache-Control"]!, Vary: "Accept-Encoding" });
    return res.end();
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(body).pipe(res);
}

// ---------- chat ----------
async function chat(req: IncomingMessage, res: ServerResponse) {
  if (!ai) return json(res, 503, { error: "AI advisor not configured (GEMINI_API_KEY missing)", code: "unavailable" });

  let body: z.infer<typeof ChatBody>;
  try {
    body = ChatBody.parse(JSON.parse(await readBody(req)));
  } catch (err) {
    return json(res, 400, { error: err instanceof z.ZodError ? err.issues[0]?.message : "invalid JSON body" });
  }

  const verdict = allow(clientIp(req));
  if (verdict !== "ok") {
    return json(res, 429, {
      code: "quota",
      error: verdict === "ip" ? "You've asked a lot of questions in a short time. Please wait a few minutes, or use guided matching." : "The advisor's free daily quota is used up. Guided matching still works.",
    });
  }

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (e: AgentEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    await runAdvisor(body.messages, send, { ai, models: MODELS, dataset: getDataset(), signal: abort.signal });
  } catch (err) {
    if (!abort.signal.aborted) {
      const event = errorEvent(err);
      console.error("[advisor]", event.type === "error" && event.code === "unavailable" ? "Gemini unavailable or GEMINI_API_KEY rejected:" : "", (err as Error).message.slice(0, 300));
      send(event);
    }
  } finally {
    res.end();
  }
}

// Baseline security headers for every response. The CSP allows only this origin plus Google Fonts.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (process.env.TRUST_PROXY && req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  try {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/api/health" && (req.method === "GET" || req.method === "HEAD")) {
      return json(res, 200, { ok: true, ai: !!ai, models: ai ? MODELS : [], dataGeneratedAt: getDataset().generatedAt });
    }
    if (path === "/api/chat") {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });
      return await chat(req, res);
    }
    if (path.startsWith("/api/")) return json(res, 404, { error: "not found" });
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
    else res.end();
  }
});

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`GrantKosh Advisor on http://localhost:${PORT}  (AI: ${MOCK ? "MOCK" : ai ? MODELS.join(" → ") : "off, guided mode only"}; data: ${getDataset().opportunities.length} programmes)`);
  });
  // Platforms send SIGTERM on redeploy: stop accepting, let in-flight answers finish (max 10s).
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
