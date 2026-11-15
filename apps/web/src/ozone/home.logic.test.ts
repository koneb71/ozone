import { describe, expect, it } from "vite-plus/test";

import {
  appNameFromPrompt,
  planFirstMessage,
  PLAN_FIRST_REQUEST,
  splitPlanFirstRequest,
} from "./home.logic";

describe("appNameFromPrompt", () => {
  it.each([
    ["a habit tracker with streaks and a weekly chart", "Habit tracker"],
    ["Build me a CRM for a small design studio", "CRM"],
    ["Please create an invoice generator. It should export PDFs", "Invoice generator"],
    ["Recipe box", "Recipe box"],
    ["I want an app to split bills with friends", "App to split bills"],
    [
      "make a really really long kanban board name that goes on forever",
      "Really really long kanban",
    ],
    ["日記アプリを作って", "日記アプリを作って"],
    ["   ", "New app"],
    ["build", "Build"],
  ])("names %j %j", (prompt, name) => {
    expect(appNameFromPrompt(prompt)).toBe(name);
  });
});

describe("planFirstMessage", () => {
  const provider = { displayName: "Agent", supportsBuildTools: true, hasPlanMode: true };
  const kickoff = (reviewPlans: boolean, change: Partial<typeof provider> = {}) =>
    planFirstMessage({
      prompt: "a habit tracker",
      reviewPlans,
      provider: { ...provider, ...change },
    });

  it.each([
    ["plan first off", kickoff(false), "a habit tracker", "default"],
    [
      "plan first, with build tools",
      kickoff(true),
      `a habit tracker\n\n${PLAN_FIRST_REQUEST}`,
      "default",
    ],
    [
      "plan first, no build tools",
      kickoff(true, { supportsBuildTools: false }),
      "a habit tracker",
      "plan",
    ],
    [
      "no build tools and plan first off",
      kickoff(false, { supportsBuildTools: false, hasPlanMode: false }),
      "a habit tracker",
      "default",
    ],
  ])("%s", (_name, result, text, interactionMode) => {
    expect(result).toEqual({ kind: "start", text, interactionMode });
  });

  it("refuses when the provider can neither file a plan nor plan on its own", () => {
    expect(kickoff(true, { supportsBuildTools: false, hasPlanMode: false }).kind).toBe("refuse");
  });
});

describe("splitPlanFirstRequest", () => {
  it.each([
    ["the request Ozone added", `make it blue\n\n${PLAN_FIRST_REQUEST}`, "make it blue", true],
    ["a message without it", "make it blue", "make it blue", false],
    [
      "the same words typed mid-message",
      `${PLAN_FIRST_REQUEST} Then make it blue`,
      `${PLAN_FIRST_REQUEST} Then make it blue`,
      false,
    ],
  ])("%s", (_name, sent, text, planFirst) => {
    expect(splitPlanFirstRequest(sent)).toEqual({ text, planFirst });
  });
});
