import { RocketIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import type { AppDeploy } from "./useAppDeploy";

/** The app's one deploy button: Deploy, Push update, Deploy again, as production stands. */
export function DeployButton(props: { readonly deploy: AppDeploy; readonly size?: "xs" | "sm" }) {
  const { action, busy, working } = props.deploy;
  if (action === null) return null;
  return (
    <Button
      disabled={busy}
      size={props.size ?? "xs"}
      variant={action.primary ? "default" : "outline"}
      onClick={() => void props.deploy.act()}
    >
      {action.kind === "busy" || working === "deploy" ? <Spinner /> : <RocketIcon />}
      {action.label}
    </Button>
  );
}
