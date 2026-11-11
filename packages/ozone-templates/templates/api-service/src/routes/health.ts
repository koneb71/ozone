import { Hono } from "hono";
import { isDatabaseReady } from "../db/index.ts";

export const health = new Hono().get("/", async (c) => {
  const db = await isDatabaseReady();
  c.header("Cache-Control", "no-store");
  return c.json({ ok: db, db }, db ? 200 : 503);
});
