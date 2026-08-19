import { env } from "./env";
import { buildServer } from "./server";

const app = await buildServer();

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
