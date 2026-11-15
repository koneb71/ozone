import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { RocketIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { useAppDeploy, type AppDeploy } from "./useAppDeploy";

/** The app's one deploy button: Deploy, Push update, Deploy again, as production stands. */
export function DeployButton(props: { readonly deploy: AppDeploy }) {
  const { action, busy, working } = props.deploy;
  if (action === null) return null;
  return (
    <Button
      disabled={busy}
      size="xs"
      variant={action.primary ? "default" : "outline"}
      onClick={() => void props.deploy.act()}
    >
      {action.kind === "busy" || working === "deploy" ? <Spinner /> : <RocketIcon />}
      {action.label}
    </Button>
  );
}

/** The deploy button where the app's page is not open, such as beside the app in its thread. */
export function AppDeployButton(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  return <DeployButton deploy={useAppDeploy(props.app, props.environmentId)} />;
}
