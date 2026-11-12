import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { visiblePreviewShows } from "./preview.logic";

const tab = (
  tabId: string,
  url: string | null,
  runtime: "server" | "desktop",
): PreviewSessionSnapshot =>
  ({
    threadId: "thread-1",
    tabId,
    navStatus: url === null ? { _tag: "Idle" } : { _tag: "Success", url, title: "" },
    canGoBack: false,
    canGoForward: false,
    runtime,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as PreviewSessionSnapshot;

describe("visiblePreviewShows", () => {
  const sessions = Object.fromEntries(
    [
      tab("server", "http://localhost:41000/sign-in", "server"),
      tab("docs", "https://tanstack.com/start", "desktop"),
      tab("blank", null, "desktop"),
      tab("other-app", "http://localhost:41001/", "desktop"),
      tab("app", "http://localhost:41000/history", "desktop"),
    ].map((session) => [session.tabId, session]),
  );

  it.each([
    ["app", true],
    // The server reloads its own tabs, for every client watching them.
    ["server", false],
    ["docs", false],
    ["blank", false],
    ["other-app", false],
    [null, false],
  ])("the tab on screen is %s: %s", (activeTabId, expected) => {
    expect(visiblePreviewShows({ sessions, activeTabId }, "http://localhost:41000")).toBe(expected);
  });
});
