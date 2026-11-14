import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import { planAwaitingAnswer } from "./planReview.logic";

const message = (id: string, role: "user" | "assistant") =>
  ({ id, kind: "message", createdAt: "", message: { id, role } }) as unknown as TimelineEntry;
const plan = (id: string) =>
  ({
    id,
    kind: "proposed-plan",
    createdAt: "",
    proposedPlan: { id, planMarkdown: `# ${id}` },
  }) as unknown as TimelineEntry;

describe("planAwaitingAnswer", () => {
  it.each([
    ["nothing proposed", [message("u1", "user"), message("a1", "assistant")], null],
    ["a plan after the last message", [message("u1", "user"), plan("p1")], "p1"],
    [
      "the agent wrote after its plan",
      [message("u1", "user"), plan("p1"), message("a1", "assistant")],
      "p1",
    ],
    ["the newest of two plans", [message("u1", "user"), plan("p1"), plan("p2")], "p2"],
    [
      "the person already replied",
      [message("u1", "user"), plan("p1"), message("u2", "user")],
      null,
    ],
    ["an empty thread", [], null],
  ])("%s", (_name, entries, expected) => {
    expect(planAwaitingAnswer(entries)?.id ?? null).toBe(expected);
  });
});
