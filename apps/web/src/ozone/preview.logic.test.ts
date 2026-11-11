import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { previewTabsShowing } from "./preview.logic";

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

describe("previewTabsShowing", () => {
  it("reloads the tabs that show the app and leaves the person's own browsing alone", () => {
    const sessions = Object.fromEntries(
      [
        tab("app-error", "http://localhost:41000/sign-in", "server"),
        tab("docs", "https://tanstack.com/start", "server"),
        tab("blank", null, "server"),
        tab("other-app", "http://localhost:41001/", "server"),
        tab("desktop-visible", "http://localhost:41000/", "desktop"),
        tab("desktop-hidden", "http://localhost:41000/history", "desktop"),
      ].map((session) => [session.tabId, session]),
    );

    expect(
      previewTabsShowing({ sessions, activeTabId: "desktop-visible" }, "http://localhost:41000"),
    ).toEqual([
      { tabId: "app-error", through: "server" },
      // A desktop tab has no handle of its own: only the one on screen can be reloaded.
      { tabId: "desktop-visible", through: "visible-preview" },
    ]);
  });
});
