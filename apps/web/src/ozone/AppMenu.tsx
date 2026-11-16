import type {
  EnvironmentId,
  OzoneApp,
  OzoneRuntimeAction,
  OzoneRuntimePhase,
} from "@t3tools/contracts";
import { EllipsisIcon, HammerIcon, RotateCwIcon, SquareIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";

import { useOpenAppPage } from "./app-page/navigation";
import { APP_MENU_PAGES } from "./app-page/menuPages";
import { appActionsFor } from "./appPage.logic";
import { useDeleteAppItem } from "./DeleteApp";

/** The app's actions beside its notice in a thread: its containers, its page, its end. */
export function AppMenu(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly phase: OzoneRuntimePhase | undefined;
  /** An action on the app's containers has not finished. */
  readonly acting: boolean;
  readonly onAct: (action: OzoneRuntimeAction) => void;
}) {
  const { app, environmentId, phase } = props;
  const openPage = useOpenAppPage();
  const offered = appActionsFor({ phase, acting: props.acting });
  const deletion = useDeleteAppItem({ app, environmentId, disabled: !offered.delete });

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
          <MenuItem disabled={!offered.restart} onClick={() => props.onAct("restart")}>
            <RotateCwIcon />
            Restart
          </MenuItem>
          <MenuItem disabled={!offered.rebuild} onClick={() => props.onAct("rebuild")}>
            <HammerIcon />
            Rebuild
          </MenuItem>
          <MenuItem disabled={!offered.stop} onClick={() => props.onAct("stop")}>
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
          {deletion.item}
        </MenuPopup>
      </Menu>
      {deletion.dialog}
    </>
  );
}
