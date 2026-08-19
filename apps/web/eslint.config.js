import { nextConfig } from "@ori/config/eslint/next";

const config = [...nextConfig, { ignores: ["next-env.d.ts"] }];

export default config;
