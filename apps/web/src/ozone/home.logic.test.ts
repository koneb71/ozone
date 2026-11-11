import { describe, expect, it } from "vite-plus/test";

import { appNameFromPrompt } from "./home.logic";

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
