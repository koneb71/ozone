import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import {
  EllipsisIcon,
  ExternalLinkIcon,
  HammerIcon,
  MessageSquareIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";

import { appActionsFor } from "../appPage.logic";
import { useDeleteAppItem } from "../DeleteApp";
import { StatusDot } from "../ui/StatusDot";
import { useOpenAppThread } from "../useOpenAppThread";
import { DeployButton } from "./DeployButton";
import type { AppDeploy } from "./useAppDeploy";
import { useAppRuntime } from "./useAppRuntime";

/** The app's state and the actions on its containers, in the page's header. */
export function AppHeaderActions(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deploy: AppDeploy;
  /** The Deploy section is open, so a button that only leads there has nothing to add. */
  readonly onDeploySection: boolean;
}) {
  const { app, environmentId } = props;
  const production = props.deploy.status;
  const runtime = useAppRuntime(app, environmentId);
  const thread = useOpenAppThread(environmentId);
  const phase = runtime.phase;
  const offered = appActionsFor({ phase, acting: runtime.working !== null });
  const deletion = useDeleteAppItem({ app, environmentId, disabled: !offered.delete });
  const stopped = phase === "stopped" || phase === "failed";
  const busy = runtime.working !== null || phase === "starting";

  return (
    <>
      <span className="me-1 flex items-center gap-2 text-muted-foreground text-xs max-sm:hidden">
        <StatusDot {...runtime.dot} label={runtime.status?.message ?? undefined} />
        {runtime.label}
      </span>
      {stopped ? (
        <Button disabled={busy} size="xs" variant="outline" onClick={() => void runtime.act("up")}>
          {runtime.working === "up" ? <Spinner /> : <PlayIcon />}
          <span className="max-sm:sr-only">Start</span>
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" onClick={() => thread.open(app)}>
        <MessageSquareIcon />
        <span className="max-sm:sr-only">Open thread</span>
      </Button>
      {production?.state === "running" && production.url !== null ? (
        <Button
          render={<a href={production.url} rel="noreferrer" target="_blank" />}
          size="xs"
          variant="ghost"
        >
          <ExternalLinkIcon />
          <span className="max-sm:sr-only">Open site</span>
        </Button>
      ) : null}
      {props.onDeploySection && props.deploy.action?.kind === "open" ? null : (
        <DeployButton deploy={props.deploy} />
      )}
      <Menu>
        <MenuTrigger
          aria-label={`More actions for ${app.name}`}
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem disabled={!offered.restart} onClick={() => void runtime.act("restart")}>
            <RotateCwIcon />
            Restart
          </MenuItem>
          <MenuItem disabled={!offered.rebuild} onClick={() => void runtime.act("rebuild")}>
            <HammerIcon />
            Rebuild
          </MenuItem>
          <MenuItem disabled={!offered.stop} onClick={() => void runtime.act("stop")}>
            <SquareIcon />
            Stop
          </MenuItem>
          <MenuSeparator />
          {deletion.item}
        </MenuPopup>
      </Menu>
      {deletion.dialog}
    </>
  );
}
