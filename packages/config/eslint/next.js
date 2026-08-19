import { FlatCompat } from "@eslint/eslintrc";

import { coreConfig } from "./core.js";

const compat = new FlatCompat({ baseDirectory: process.cwd() });

// Next's "next/core-web-vitals" preset bundles its own eslint-plugin-import,
// so this extends coreConfig (no import plugin) rather than baseConfig to
// avoid a duplicate-plugin-registration conflict.
/** @type {import('eslint').Linter.Config[]} */
export const nextConfig = [...coreConfig, ...compat.extends("next/core-web-vitals")];

export default nextConfig;
