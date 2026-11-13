import { createFileRoute } from "@tanstack/react-router";

import { ServersSettingsPanel } from "../ozone/ServersSettings";

export const Route = createFileRoute("/_chat/settings/servers")({
  component: ServersSettingsPanel,
});
