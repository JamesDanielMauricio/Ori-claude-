import { cp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build } from "vite";

import { bundleVercelFunction } from "../../api/scripts/bundle-vercel-function.mjs";

// Builds the website and the API into one Vercel deployment, written in
// Vercel's Build Output API layout (.vercel/output), which Vercel serves
// exactly as written.
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(webDir, ".vercel", "output");

await rm(outputDir, { recursive: true, force: true });

// The API is served from this same address, so the website calls a relative
// "/trpc". It must be an empty string rather than unset: public-env.ts only
// falls back to localhost for a missing value (`??`).
process.env.VITE_API_URL = "";
await build({ root: webDir });
await cp(join(webDir, "dist"), join(outputDir, "static"), { recursive: true });

await bundleVercelFunction(join(outputDir, "functions", "api.func"));

await writeFile(
  join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // API paths go to the function; Fastify's router takes it from there.
        { src: "^/(trpc/.*|healthz)$", dest: "/api" },
        // Real files (index.html, /assets/...) are served as they are.
        { handle: "filesystem" },
        // Any other path is a client-side route, so it gets the app shell.
        { src: "^/.*$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
