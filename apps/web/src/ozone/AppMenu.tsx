import type {
  EnvironmentId,
  OzoneApp,
  OzoneRuntimeAction,
  OzoneRuntimePhase,
} from "@t3tools/contracts";
import { EllipsisIcon, HammerIcon, RotateCwIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";

import { useOpenAppPage } from "./app-page/navigation";
import { APP_MENU_PAGES } from "./app-page/menuPages";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { DELETE_APP_DESCRIPTION, useDeleteApp } from "./useDeleteApp";

/** The app's actions beside its notice in a thread: its containers, its page, its end. */
export function AppMenu(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly phase: OzoneRuntimePhase | undefined;
  readonly onAct: (action: OzoneRuntimeAction) => void;
}) {
  const { app, environmentId, phase } = props;
  const openPage = useOpenAppPage();
  const removal = useDeleteApp(environmentId);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
          {APP_MENU_PAGES.map(({ section, label, icon: Icon }) => (
            <MenuItem
              key={section}
              onClick={() => void openPage(environmentId, app.projectId, section)}
            >
              <Icon />
              {label}
            </MenuItem>
          ))}
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
