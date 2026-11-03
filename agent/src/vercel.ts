// Vercel function entry: scripts/vercel-output.mjs bundles this file into api/health.func and api/chat.func.
// Vercel serves the static UI from its CDN, so only /api/* reaches this code.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi, setSecurityHeaders } from "./api";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setSecurityHeaders(req, res);
  await handleApi(req, res);
}
