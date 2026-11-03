import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages project sites and any sub-path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // In development the advisor API runs separately (npm run dev:agent); proxy it.
  // The Host header is kept so the API's same-origin check sees the page's own origin.
  server: { proxy: { "/api": { target: process.env.ADVISOR_URL ?? "http://localhost:8787", changeOrigin: false } } },
});
