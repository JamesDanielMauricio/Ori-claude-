import reactHooks from "eslint-plugin-react-hooks";

import { coreConfig } from "./core.js";

// Extends coreConfig, not baseConfig — the same choice the old nextConfig
// made. apps/web has never had the repo's custom `import/order` rule
// applied to it (Next's preset bundled its own copy of eslint-plugin-import
// and the two conflicted), so pulling baseConfig in here would light up
// dozens of ordering warnings across files this migration never touched.
// Opting apps/web into baseConfig is a reasonable follow-up, but it's a
// lint-policy change, not part of swapping the framework.
//
// "next/core-web-vitals" is gone, and with it the rules-of-hooks checks it
// bundled, so react-hooks is registered explicitly here to keep that
// coverage. Deliberately just these two rules rather than the plugin's
// current `recommended` set: v7's recommended adds the React Compiler
// rules, which flag patterns throughout the existing codebase that the Next
// config never objected to. Same signal as before, no new failures on
// untouched code.
/** @type {import('eslint').Linter.Config[]} */
export const reactConfig = [
  ...coreConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // A hook behind a condition or a loop — always a real bug.
      "react-hooks/rules-of-hooks": "error",
      // A missing dependency is usually a stale-closure bug, but the fix is
      // sometimes a deliberate restructure, so: warn, as Next had it.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default reactConfig;
