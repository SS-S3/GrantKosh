// Precompress the built site (gzip + brotli) so the server never compresses on the fly.
// The data JSON is ~7.5 MB raw and ~1 MB brotli, which matters for founders on mobile data.
// Usage: node scripts/compress.mjs [dir=web/dist]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = process.argv[2] ?? new URL("../web/dist", import.meta.url).pathname;
const EXT = /\.(html|js|css|json|svg|txt|webmanifest)$/;
let raw = 0, br = 0, files = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.test(name) && statSync(p).size > 1024) {
      const buf = readFileSync(p);
      const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      writeFileSync(`${p}.br`, b);
      writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
      raw += buf.length; br += b.length; files++;
    }
  }
}

walk(root);
console.log(`compressed ${files} files: ${(raw / 1e6).toFixed(1)} MB → ${(br / 1e6).toFixed(1)} MB brotli`);
