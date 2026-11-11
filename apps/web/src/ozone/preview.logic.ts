import type { PreviewSessionSnapshot } from "@t3tools/contracts";

export interface PreviewReload {
  readonly tabId: string;
  /** A tab the server runs is reloaded by id. Any other tab only through the visible preview. */
  readonly through: "server" | "visible-preview";
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * The preview tabs to reload after an app changed: those showing the app. A tab on another site is
 * the person's own browsing and is left alone.
 */
export function previewTabsShowing(
  preview: {
    readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
    readonly activeTabId: string | null;
  },
  appUrl: string,
): ReadonlyArray<PreviewReload> {
  const appOrigin = originOf(appUrl);
  if (appOrigin === null) return [];
  return Object.values(preview.sessions).flatMap((session): ReadonlyArray<PreviewReload> => {
    if (session.navStatus._tag === "Idle" || originOf(session.navStatus.url) !== appOrigin) {
      return [];
    }
    if (session.runtime === "server") return [{ tabId: session.tabId, through: "server" }];
    return session.tabId === preview.activeTabId
      ? [{ tabId: session.tabId, through: "visible-preview" }]
      : [];
  });
}
