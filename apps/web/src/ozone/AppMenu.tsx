import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OzoneApp,
  OzoneRuntimeAction,
  OzoneRuntimePhase,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  DatabaseIcon,
  EllipsisIcon,
  HammerIcon,
  HistoryIcon,
  ListChecksIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { ensureLocalApi } from "~/localApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAtomCommand } from "~/state/use-atom-command";

import { AppBuildSettingsDialog } from "./AppBuildSettingsDialog";
import { AppDataDialog } from "./AppDataDialog";
import { AppHistoryDialog } from "./AppHistoryDialog";
import { AppLogsDialog } from "./AppLogsDialog";
import { ozoneEnvironment } from "./state";

type AppDialog = "logs" | "data" | "history" | "build";

/** Everything a person can do to an app besides opening it: its containers, its data, its end. */
export function AppMenu(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly phase: OzoneRuntimePhase | undefined;
  readonly onAct: (action: OzoneRuntimeAction) => void;
}) {
  const { app, environmentId, phase } = props;
  const navigate = useNavigate();
  const deleteApp = useAtomCommand(ozoneEnvironment.deleteApp, { reportFailure: false });
  const [dialog, setDialog] = useState<AppDialog | null>(null);
  const closeDialog = (open: boolean) => setDialog((current) => (open ? current : null));

  const remove = async () => {
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        [
          `Delete ${app.name}?`,
          "Its containers and its database are removed, and its threads leave Ozone.",
          "A snapshot of the data is taken first and kept. The app's folder stays on disk.",
        ].join("\n"),
        { variant: "destructive" },
      )
      .catch(() => false);
    if (!confirmed) return;
    const result = await deleteApp({ environmentId, input: { projectId: app.projectId } });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not delete ${app.name}`,
          description: error instanceof Error ? error.message : undefined,
        }),
      );
      return;
    }
    appAtomRegistry.refresh(ozoneEnvironment.apps({ environmentId, input: {} }));
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `${app.name} is deleted`,
        description: `Its folder is still at ${result.value.workspaceRoot}.`,
      }),
    );
    await navigate({ to: "/" });
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label={`Manage ${app.name}`}
          render={<Button size="icon-xs" variant="ghost" />}
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            disabled={phase !== "running" && phase !== "unhealthy"}
            onClick={() => props.onAct("restart")}
          >
            <RotateCwIcon />
            Restart
          </MenuItem>
          <MenuItem disabled={phase === "unavailable"} onClick={() => props.onAct("rebuild")}>
            <HammerIcon />
            Rebuild
          </MenuItem>
          <MenuItem
            disabled={phase === "stopped" || phase === "unavailable" || phase === undefined}
            onClick={() => props.onAct("stop")}
          >
            <SquareIcon />
            Stop
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => setDialog("logs")}>
            <ScrollTextIcon />
            Logs
          </MenuItem>
          <MenuItem onClick={() => setDialog("data")}>
            <DatabaseIcon />
            Data
          </MenuItem>
          <MenuItem onClick={() => setDialog("history")}>
            <HistoryIcon />
            History
          </MenuItem>
          <MenuItem onClick={() => setDialog("build")}>
            <ListChecksIcon />
            Build settings
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={phase === "unavailable"} onClick={() => void remove()}>
            <Trash2Icon />
            Delete app
          </MenuItem>
        </MenuPopup>
      </Menu>
      <AppLogsDialog
        app={app}
        environmentId={environmentId}
        open={dialog === "logs"}
        onOpenChange={closeDialog}
      />
      <AppDataDialog
        app={app}
        environmentId={environmentId}
        open={dialog === "data"}
        onOpenChange={closeDialog}
      />
      <AppHistoryDialog
        app={app}
        environmentId={environmentId}
        open={dialog === "history"}
        onOpenChange={closeDialog}
      />
      <AppBuildSettingsDialog
        app={app}
        environmentId={environmentId}
        open={dialog === "build"}
        onOpenChange={closeDialog}
      />
    </>
  );
}
