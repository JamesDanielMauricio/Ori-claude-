import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";

import { createContext } from "./context";
import { appRouter } from "./router";

export async function buildServer() {
  const app = Fastify({ logger: true });

  // Auth is a bearer token in the Authorization header (the caller's
  // Supabase access token), not a cookie — no credentials/cookie exchange
  // with this server.
  await app.register(cors, { origin: true });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
