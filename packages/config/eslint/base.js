import importPlugin from "eslint-plugin-import";

import { coreConfig } from "./core.js";

/** @type {import('eslint').Linter.Config[]} */
export const baseConfig = [
  ...coreConfig,
  importPlugin.flatConfigs.recommended,
  {
    rules: {
      "import/no-unresolved": "off",
      "import/order": [
        "warn",
        {
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },
];

export default baseConfig;
