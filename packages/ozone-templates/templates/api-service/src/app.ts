import { Hono } from "hono";
import { health } from "./routes/health.ts";

/** The whole service. Each resource is a router of its own, mounted here. */
export const app = new Hono()
  .get("/", (c) => c.json({ name: "__OZONE_APP_NAME__", health: "/api/health" }))
  .route("/api/health", health)
  .notFound((c) => c.json({ error: "Not found" }, 404))
  .onError((error, c) => {
    console.error(error);
    return c.json({ error: "Something went wrong" }, 500);
  });
