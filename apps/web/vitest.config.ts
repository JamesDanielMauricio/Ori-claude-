import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// Extends the app's own Vite config rather than redeclaring anything, so the
// `@/*` alias (and any future resolve/plugin change) has exactly one
// definition. Without this, a test importing a module that uses `@/...`
// fails to resolve it even though the app builds fine.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      passWithNoTests: true,
    },
  }),
);
