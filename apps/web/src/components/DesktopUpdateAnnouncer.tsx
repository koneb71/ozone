import { useEffect } from "react";

import { useDesktopUpdateState } from "../state/desktopUpdate";
import { desktopUpdateToAnnounce } from "./desktopUpdate.logic";
import { showDesktopUpdateAvailableToast } from "./desktopUpdate.toast";
import { downloadLocalUpdate } from "./sidebar/SidebarUpdatePill";

const ANNOUNCED_KEY = "ozone:update-announced";

const readAnnounced = () => {
  try {
    return window.localStorage.getItem(ANNOUNCED_KEY);
  } catch {
    return null;
  }
};

/** Tells the person once per version that an update is out. Renders nothing. */
export function DesktopUpdateAnnouncer() {
  const version = desktopUpdateToAnnounce(useDesktopUpdateState(), readAnnounced());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- raises a toast and records it in local storage when the desktop shell reports a new version
  useEffect(() => {
    if (version === null) return;
    try {
      window.localStorage.setItem(ANNOUNCED_KEY, version);
    } catch {
      // Without storage the toast may repeat after a restart, which is better than never showing.
    }
    showDesktopUpdateAvailableToast(version, () => {
      const bridge = window.desktopBridge;
      if (bridge) void downloadLocalUpdate(bridge, { notifyDownloaded: true });
    });
  }, [version]);
  return null;
}
