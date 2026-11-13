import { createFileRoute } from "@tanstack/react-router";

// ozone-seam: registers Settings › Servers.
import { ServersSettingsPanel } from "../ozone/ServersSettings";

export const Route = createFileRoute("/_chat/settings/servers")({
  component: ServersSettingsPanel,
});
