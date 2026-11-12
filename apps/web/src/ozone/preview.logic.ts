import type { PreviewSessionSnapshot } from "@t3tools/contracts";

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

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
