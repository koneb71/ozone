import { createFileRoute } from "@tanstack/react-router";

import { LocalEnvironmentOffState } from "../components/LocalEnvironmentOffState";
import { useEnvironments } from "../state/environments";
import { OzoneHome } from "../ozone/OzoneHome";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "local-environment-off") {
    if (!isReady) return null;
    if (environments.length === 0) return <LocalEnvironmentOffState />;
  }

  return <OzoneHome />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
