import { reactConfig } from "@ori/config/eslint/react";

const config = [...reactConfig, { ignores: ["dist/**"] }];

export default config;
