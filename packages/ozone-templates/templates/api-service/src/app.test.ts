import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

describe("app", () => {
  it("says what it is at its root", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ health: "/api/health" });
  });

  it("answers an unknown path with a JSON 404", async () => {
    const response = await app.request("/nowhere");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
