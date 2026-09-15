import { reactConfig } from "@ori/config/eslint/react";

const config = [...reactConfig, { ignores: ["dist/**", ".vercel/**"] }];

export default config;
