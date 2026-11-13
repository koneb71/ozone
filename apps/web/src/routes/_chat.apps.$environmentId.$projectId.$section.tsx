import { createFileRoute } from "@tanstack/react-router";

import { AppPageRoute } from "../ozone/app-page/AppPage";

export const Route = createFileRoute("/_chat/apps/$environmentId/$projectId/$section")({
  component: () => <AppPageRoute params={Route.useParams()} />,
});
