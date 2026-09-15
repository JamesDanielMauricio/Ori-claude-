import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

// Writes Vercel's Build Output API layout (.vercel/output). Vercel deploys
// that folder exactly as written, so the function and its routing are spelled
// out here rather than inferred from folder conventions.
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(appDir, ".vercel", "output");
const functionDir = join(outputDir, "functions", "index.func");

await rm(outputDir, { recursive: true, force: true });
await mkdir(functionDir, { recursive: true });

// This repo's imports omit file extensions and its workspace packages export
// raw .ts files. Only a bundler resolves those, so the API and every
// dependency go into one file that plain Node can load.
await build({
  entryPoints: [join(appDir, "src", "vercel.ts")],
  outfile: join(functionDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // Some bundled dependencies are CommonJS and call require() at runtime,
  // which an ES module doesn't have on its own.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

await writeFile(
  join(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddSourcemapSupport: true,
    },
    null,
    2,
  ),
);

// Every path goes to the one function; Fastify's router takes it from there.
await writeFile(
  join(outputDir, "config.json"),
  JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2),
);
