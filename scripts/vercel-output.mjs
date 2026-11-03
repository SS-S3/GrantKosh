// Writes a Vercel Build Output (https://vercel.com/docs/build-output-api/v3) to .vercel/output/:
//   static/            the built site from web/dist, served by Vercel's CDN
//   functions/api/*    the Advisor API (agent/src/vercel.ts) bundled with esbuild, plus a copy of the data
//   config.json        cache and security headers, and the single-page-app fallback to index.html
// Run after `npm run build`. Usage: node scripts/vercel-output.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}web/dist`;
const out = `${root}.vercel/output`;
if (!existsSync(`${dist}/index.html`)) throw new Error("web/dist is missing. Run `npm run build` first.");

rmSync(out, { recursive: true, force: true });
// Vercel compresses responses itself, so leave out the .br/.gz copies made by scripts/compress.mjs.
cpSync(dist, `${out}/static`, { recursive: true, filter: src => !/\.(br|gz)$/.test(src) });

// Same headers the Node server sets (agent/src/api.ts), including the Clerk origin from the publishable key.
const HEADERS = JSON.parse(readFileSync(`${root}agent/src/security-headers.json`, "utf8"));
const clerkHost = Buffer.from((process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").split("_")[2] ?? "", "base64").toString("utf8").replace(/\$$/, "");
const clerk = /^[a-z0-9.-]+$/i.test(clerkHost) ? `https://${clerkHost}` : null;
const SECURITY_HEADERS = {
  "Content-Security-Policy": Object.entries(HEADERS.csp)
    .map(([k, v]) => [k, ...v, ...(clerk && (k === "script-src" || k === "connect-src") ? [clerk] : [])].join(" "))
    .join("; "),
  ...HEADERS.headers,
};

const bundle = `${root}.vercel/api.mjs`;
await build({
  entryPoints: [`${root}agent/src/vercel.ts`],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: bundle,
  legalComments: "none",
  logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

for (const name of ["health", "me", "chat", "billing/subscribe", "billing/webhook"]) {
  const fn = `${out}/functions/api/${name}.func`;
  mkdirSync(`${fn}/data`, { recursive: true });
  cpSync(bundle, `${fn}/index.mjs`);
  // Only health and chat read the dataset.
  if (name === "health" || name === "chat") for (const file of ["opportunities.json", "investors.json", "meta.json"]) cpSync(`${dist}/data/${file}`, `${fn}/data/${file}`);
  writeFileSync(
    `${fn}/.vc-config.json`,
    JSON.stringify({
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // A chat answer with several tool calls and model fallbacks can take a while.
      maxDuration: name === "chat" ? 60 : 15,
    }, null, 2),
  );
}
rmSync(bundle);

const hsts = { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" };
writeFileSync(
  `${out}/config.json`,
  JSON.stringify({
    version: 3,
    routes: [
      { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
      { src: "/data/(.*)", headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400", "X-Robots-Tag": "noindex, nofollow" }, continue: true },
      { src: "/(.*)", headers: { ...SECURITY_HEADERS, ...hsts }, continue: true },
      { handle: "filesystem" },
      // Unknown asset, data and API paths are real 404s; anything else is a client-side route.
      { src: "/(assets|data|api)/.*", status: 404 },
      { src: "/.*", dest: "/index.html" },
    ],
  }, null, 2),
);
console.log("wrote .vercel/output (static site + API functions)");
