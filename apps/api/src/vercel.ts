import type { IncomingMessage, ServerResponse } from "node:http";

import { buildServer } from "./server";

// Vercel runs this once per request instead of a long-lived `.listen()`
// server (bundled by scripts/build-vercel.mjs), so the Fastify app is built
// once per cold start and reused by warm invocations. A failed build isn't
// cached, so the next request retries instead of the instance staying broken.
let appReady: ReturnType<typeof buildServer> | undefined;

function getApp() {
  if (!appReady) {
    appReady = buildServer().then(async (app) => {
      await app.ready();
      return app;
    });
    appReady.catch(() => {
      appReady = undefined;
    });
  }
  return appReady;
}

// `.listen()` only subscribes Fastify to its http.Server's "request" event;
// emitting that event with Vercel's req/res feeds it a request the same way,
// so the existing routes (/trpc, /healthz) match on the original path.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
