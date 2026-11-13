import { usePrimaryEnvironmentId } from "~/state/environments";

import { ServersSection } from "./app-page/ServersSection";

/** Settings › Servers: where SSH hosts and Dokploy are added, with or without an app yet. */
export function ServersSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <ServersSection environmentId={environmentId} />;
}
