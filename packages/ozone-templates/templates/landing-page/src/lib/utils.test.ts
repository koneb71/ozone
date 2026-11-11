import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins class names and skips falsy values", () => {
    expect(cn("flex", false, null, undefined, "gap-2")).toBe("flex gap-2");
  });

  it("applies conditional classes", () => {
    expect(cn("text-sm", { "font-medium": true, underline: false })).toBe("text-sm font-medium");
  });

  it("lets a later Tailwind class override an earlier one", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
