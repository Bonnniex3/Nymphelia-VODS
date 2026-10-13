import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Placeholder archive: while the real manifest is empty (no IA collections yet), or
// with `vite --mode mock`, the VOD manifest is swapped for a sample archive so the
// site is fully browsable. As soon as `npm run fetch-vods` writes real VODs, every
// build (including production) uses them and the samples drop out automatically.
const SAMPLE_VODS = fileURLToPath(new URL("./src/vods/data/vods.sample.js", import.meta.url));
const REAL_VODS = new URL("./src/vods/data/vods.json", import.meta.url);
const hasRealVods = () => {
  try {
    return JSON.parse(readFileSync(REAL_VODS, "utf8")).length > 0;
  } catch {
    return false;
  }
};

// Every browser we target reads woff2, so drop Fontsource's .woff fallbacks
// (halves the @font-face CSS and stops Vite emitting/inlining unused files).
const woff2Only = {
  name: "fontsource-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("@fontsource") || !id.endsWith(".css")) return;
    return code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, "");
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [woff2Only, react(), tailwindcss()],
  resolve: {
    alias: mode === "mock" || !hasRealVods() ? [{ find: /^.*\/vods\.json$/, replacement: SAMPLE_VODS }] : [],
  },
  server: { port: 3000 },
  preview: { port: 3000 },
  build: {
    // Vercel and Netlify are both configured to serve `prod/`.
    outDir: "prod",
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    // Never base64 fonts into CSS; the unicode-range subsets should load on demand.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
}));
