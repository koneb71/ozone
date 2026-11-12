import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OzoneApp, OzoneDeletedApp } from "@t3tools/contracts";
import {
  DatabaseIcon,
  EllipsisIcon,
  RocketIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { useOpenAppPage } from "./app-page/navigation";
import { metaLine, phaseTone, type AppSection } from "./appPage.logic";
import { runtimePhaseLabel } from "@t3tools/client-runtime/state/ozone";
import { ozoneEnvironment } from "./state";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { StatusDot } from "./ui/StatusDot";
import { useOzoneCommand } from "./ui/useOzoneCommand";
import { DELETE_APP_DESCRIPTION, useDeleteApp } from "./useDeleteApp";
import { useOpenAppThread } from "./useOpenAppThread";

/** Home's list of apps: each with its state, a way into its thread, and its page. */
export function HomeApps(props: {
  readonly apps: ReadonlyArray<OzoneApp> | null;
  readonly environmentId: EnvironmentId;
}) {
  const thread = useOpenAppThread(props.environmentId);
  if (props.apps !== null && props.apps.length === 0) return null;
  return (
    <SettingsSection title="Your apps">
      {props.apps === null
        ? [0, 1].map((index) => (
            <SettingsRow key={index} title={<Skeleton className="h-4 w-40" />} />
          ))
        : props.apps.map((app) => (
            <AppRow
              key={app.projectId}
              app={app}
              environmentId={props.environmentId}
              updatedAt={thread.latestOf(app)?.updatedAt ?? null}
              onOpen={() => thread.open(app)}
            />
          ))}
    </SettingsSection>
  );
}

const MENU: ReadonlyArray<{
  readonly section: AppSection;
  readonly label: string;
  readonly icon: typeof DatabaseIcon;
}> = [
  { section: "overview", label: "App page", icon: SlidersHorizontalIcon },
  { section: "deploy", label: "Deploy", icon: RocketIcon },
  { section: "data", label: "Data", icon: DatabaseIcon },
  { section: "logs", label: "Logs", icon: ScrollTextIcon },
];

function AppRow(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly updatedAt: string | null;
  readonly onOpen: () => void;
}) {
  const { app, environmentId } = props;
  const openPage = useOpenAppPage();
  const removal = useDeleteApp(environmentId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const phase = useEnvironmentQuery(
    ozoneEnvironment.runtimeStatus({ environmentId, input: { projectId: app.projectId } }),
  ).data?.phase;
  const label = runtimePhaseLabel(phase).label;

  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot {...phaseTone(phase)} label={label} />
          <span className="truncate">{app.name}</span>
        </span>
      }
      description={metaLine([
        label,
        `localhost:${app.port}`,
        props.updatedAt === null ? null : `active ${formatRelativeTimeLabel(props.updatedAt)}`,
      ])}
      control={
        <div className="flex items-center gap-1">
          <Button size="xs" variant="outline" onClick={props.onOpen}>
            Open
          </Button>
          <Menu>
            <MenuTrigger
              aria-label={`More for ${app.name}`}
              render={<Button size="icon-xs" variant="ghost" />}
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {MENU.map(({ section, label: itemLabel, icon: Icon }) => (
                <MenuItem
                  key={section}
                  onClick={() => void openPage(environmentId, app.projectId, section)}
                >
                  <Icon />
                  {itemLabel}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={removal.deleting}
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
        </div>
      }
    />
  );
}

/** Deleted apps whose folder and snapshot are still there, each one step from coming back. */
export function DeletedApps(props: {
  readonly apps: ReadonlyArray<OzoneDeletedApp>;
  readonly environmentId: EnvironmentId;
}) {
  const restoreApp = useAtomCommand(ozoneEnvironment.restoreApp, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const { working, run } = useOzoneCommand();
  const [chosen, setChosen] = useState<OzoneDeletedApp | null>(null);

  const bringBack = async (app: OzoneDeletedApp) => {
    const result = await run(app.slug, `Could not bring back ${app.name}`, () =>
      restoreApp({ environmentId: props.environmentId, input: { slug: app.slug } }),
    );
    appAtomRegistry.refresh(
      ozoneEnvironment.apps({ environmentId: props.environmentId, input: {} }),
    );
    // Its old threads went with the delete, so it opens on a new one.
    if (result._tag === "Success") {
      void handleNewThread(scopeProjectRef(props.environmentId, result.value.app.projectId));
    }
  };

  if (props.apps.length === 0) return null;
  return (
    <SettingsSection title="Recently deleted">
      {props.apps.map((app) => (
        <SettingsRow
          key={app.slug}
          title={app.name}
          description={metaLine([
            app.deletedAt === null
              ? "Deleted"
              : `Deleted ${formatRelativeTimeLabel(app.deletedAt)}`,
            "code and last snapshot kept",
          ])}
          control={
            <Button
              disabled={working !== null}
              size="xs"
              variant="ghost"
              onClick={() => setChosen(app)}
            >
              {working === app.slug ? <Spinner /> : null}
              Bring back
            </Button>
          }
        />
      ))}
      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(open) => {
          if (!open) setChosen(null);
        }}
        title={`Bring back ${chosen?.name ?? "the app"}?`}
        description="It returns with its code and the data of its last snapshot, on a new thread."
        confirmLabel="Bring back"
        onConfirm={() => {
          if (chosen !== null) void bringBack(chosen);
        }}
      />
    </SettingsSection>
  );
}
