// GrantKosh server for a long-running Node process (Docker, Render, Oracle): the Advisor API from api.ts
// plus the built UI from web/dist. Vercel serves the UI itself and runs api.ts through vercel.ts instead.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FREE_MODELS, MODELS, MOCK, handleApi, json, keys, setSecurityHeaders } from "./api";
import { getDataset } from "./data";

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = resolve(fileURLToPath(new URL("../../web/dist/", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

/** Long cache for content-hashed assets; revalidate everything else. */
function cacheControl(file: string): string {
  if (file.includes(`${sep}assets${sep}`)) return "public, max-age=31536000, immutable";
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

export const server = createServer(async (req, res) => {
  setSecurityHeaders(req, res);
  try {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path.startsWith("/api/")) return await handleApi(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
    else res.end();
  }
});

// Slow or half-sent requests (slowloris) are cut off; streamed answers are responses, so they aren't.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.maxHeadersCount = 64;

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`GrantKosh Advisor on http://localhost:${PORT}  (AI: ${MOCK ? "MOCK" : keys ? `${MODELS.join(" → ")}; free plan ${FREE_MODELS.join(" → ")}; ${keys.size} key(s)` : "off, guided mode only"}; data: ${getDataset().opportunities.length} programmes)`);
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
