import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Same `@/*` alias tsconfig.json declares — Vite resolves imports at
      // build time and doesn't read tsconfig paths, so it has to be stated
      // in both places or every `@/components/...` import breaks.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  optimizeDeps: {
    // These workspace packages ship TypeScript source, not built JS (this is
    // what Next's `transpilePackages` was doing). Vite's dependency
    // pre-bundler assumes anything under node_modules is already valid JS
    // and would choke on the .ts; excluding them routes the files through
    // the normal source pipeline instead.
    //
    // Only the two that are imported at runtime. @ori/db and @ori/api are
    // `import type` only, so they are erased before the bundler ever sees
    // them and listing them here would do nothing.
    exclude: ["@ori/shared", "@ori/domain"],
  },
  server: {
    port: 3000,
    // Fail loudly if 3000 is taken rather than silently moving to 3001 —
    // playwright.config.ts hard-codes baseURL http://localhost:3000, and a
    // drifting port turns into a confusing wall of e2e timeouts.
    strictPort: true,
  },
  preview: {
    port: 3000,
    strictPort: true,
  },
  build: {
    // Source maps in the production build: this is an internal tool, the
    // bundle isn't a secret, and a readable stack trace from a real user's
    // browser is worth far more here than hiding the source.
    sourcemap: true,
  },
});
