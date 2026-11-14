import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import {
  EllipsisIcon,
  ExternalLinkIcon,
  HammerIcon,
  MessageSquareIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";

import { ConfirmDialog } from "../ui/ConfirmDialog";
import { StatusDot } from "../ui/StatusDot";
import { DELETE_APP_DESCRIPTION, useDeleteApp } from "../useDeleteApp";
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
  const removal = useDeleteApp(environmentId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const phase = runtime.phase;
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
          <MenuItem
            disabled={busy || (phase !== "running" && phase !== "unhealthy")}
            onClick={() => void runtime.act("restart")}
          >
            <RotateCwIcon />
            Restart
          </MenuItem>
          <MenuItem disabled={busy} onClick={() => void runtime.act("rebuild")}>
            <HammerIcon />
            Rebuild
          </MenuItem>
          <MenuItem
            disabled={busy || stopped || phase === "unavailable" || phase === undefined}
            onClick={() => void runtime.act("stop")}
          >
            <SquareIcon />
            Stop
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            disabled={phase === "unavailable" || removal.deleting}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2Icon />
            Delete app
          </MenuItem>
        </MenuPopup>
      </Menu>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${app.name}?`}
        description={DELETE_APP_DESCRIPTION}
        confirmLabel="Delete app"
        destructive
        onConfirm={() => void removal.remove(app)}
      />
    </>
  );
}
