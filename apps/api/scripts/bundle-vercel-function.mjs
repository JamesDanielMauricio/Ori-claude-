import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bundles the API into one Vercel function folder (Build Output API format).
// This repo's imports omit file extensions and its workspace packages export
// raw .ts files, which only a bundler resolves, so the API and every
// dependency go into a single file that plain Node can load.
export async function bundleVercelFunction(functionDir) {
  await mkdir(functionDir, { recursive: true });

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
}
