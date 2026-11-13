import { isElectron } from "./env";
import { readPrimaryEnvironmentTarget } from "./environments/primary/target";

/**
 * Where copied thread and prompt links open: this app's own server. The desktop window has no
 * web origin of its own, so it names the server it runs.
 */
export function appLinkOrigin(): string {
  if (isElectron) {
    try {
      const primary = readPrimaryEnvironmentTarget();
      if (primary !== null) return new URL(primary.target.httpBaseUrl).origin;
    } catch {
      // An unreadable desktop bootstrap leaves the window's own origin.
    }
  }
  return window.location.origin;
}
