import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages project sites and any sub-path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // In development the advisor API runs separately (npm run dev:agent); proxy it.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
