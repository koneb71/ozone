import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { originOf } from "@t3tools/shared/preview";

/**
 * Whether the preview on screen is this client's own tab showing the app, which only this client
 * can reload. The server reloads the tabs it runs, and a tab on another site is the person's own
 * browsing.
 */
export function visiblePreviewShows(
  preview: {
    readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
    readonly activeTabId: string | null;
  },
  appUrl: string,
): boolean {
  const appOrigin = originOf(appUrl);
  const session = preview.activeTabId === null ? undefined : preview.sessions[preview.activeTabId];
  if (appOrigin === null || session === undefined || session.runtime === "server") return false;
  return session.navStatus._tag !== "Idle" && originOf(session.navStatus.url) === appOrigin;
}

/**
 * How this client can show a running app, which answers only on its own machine's `localhost`.
 * "usual" leaves the choice to the preview's own rules, "server" loads it in the server's browser,
 * and null means this client cannot show it.
 */
export function appPreviewReach(input: {
  /** This client shows previews at all: the desktop app, or an environment with a server browser. */
  readonly available: boolean;
  readonly sharesMachine: boolean;
  readonly serverBrowser: boolean;
}): "usual" | "server" | null {
  if (!input.available) return null;
  if (input.sharesMachine) return "usual";
  return input.serverBrowser ? "server" : null;
}
