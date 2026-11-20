import type { EnvironmentId, OzoneDeploymentRow } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { EllipsisIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { type DotTone, metaLine } from "../appPage.logic";
import { ozoneEnvironment, refreshApps } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { StatusDot } from "../ui/StatusDot";
import { useOzoneCommand } from "../ui/useOzoneCommand";

const deploymentKey = (row: OzoneDeploymentRow) =>
  `${row.slug}:${row.place.host ?? ""}:${row.place.dokploy ?? ""}:${row.place.hosted ?? ""}`;

const STATE_TONE: Record<OzoneDeploymentRow["state"], DotTone> = {
  running: "success",
  stopped: "idle",
  "data-only": "warning",
  gone: "idle",
  unreachable: "error",
  busy: "warning",
  elsewhere: "idle",
};

const stateLine = (row: OzoneDeploymentRow) => {
  switch (row.state) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped, data kept";
    case "data-only":
      return "Only its data is left";
    case "gone":
      return "Nothing is left there";
    case "unreachable":
      return row.detail ?? "Could not reach it";
    case "busy":
      return row.detail ?? "Busy";
    case "elsewhere":
      return "Its host runs it";
  }
};

/** The place inside a sentence: "on this computer", "on Box". */
const placeInText = (row: OzoneDeploymentRow | null) => {
  if (row === null) return "there";
  const { host, dokploy, hosted } = row.place;
  return host === null && dokploy === null && hosted === null ? "this computer" : row.placeLabel;
};

type Run = <A, E>(
  key: string,
  failureTitle: string,
  command: () => Promise<AtomCommandResult<A, E>>,
) => Promise<AtomCommandResult<A, E>>;

/**
 * Asks before deleting a deployment, then deletes it. `run` is the caller's, so the page that
 * shows the deployment can refresh what it shows afterwards.
 */
export function useDeleteDeployment(props: {
  readonly environmentId: EnvironmentId;
  readonly run: Run;
  readonly onDeleted: () => void;
}) {
  const removeDeployment = useAtomCommand(ozoneEnvironment.removeDeployment, {
    reportFailure: false,
  });
  const [asking, setAsking] = useState<OzoneDeploymentRow | null>(null);

  const remove = async (row: OzoneDeploymentRow) => {
    const result = await props.run(
      deploymentKey(row),
      `Could not delete the deployment of ${row.appName}`,
      () =>
        removeDeployment({
          environmentId: props.environmentId,
          input: { slug: row.slug, place: row.place },
        }),
    );
    if (result._tag === "Success") {
      const { snapshot, keptVolumes } = result.value;
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Deleted ${row.appName} on ${placeInText(row)}`,
          description:
            snapshot === null
              ? "It held no data to save."
              : `Its data is saved as snapshot ${snapshot.id}${row.projectId === null ? "" : ", under Data"}.`,
        }),
      );
      if (keptVolumes.length > 0) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Some volumes were left",
            description: `No snapshot holds ${keptVolumes.join(", ")}, so Ozone left them on ${placeInText(row)}.`,
          }),
        );
      }
    }
    props.onDeleted();
    // Deleting where the app runs turns off deploying each build, which the app's page shows.
    refreshApps(props.environmentId);
  };

  const nothingLeft = asking?.state === "gone";
  const dialog = (
    <ConfirmDialog
      open={asking !== null}
      onOpenChange={(next) => {
        if (!next) setAsking(null);
      }}
      title={
        nothingLeft
          ? `Remove ${asking?.appName ?? "the app"} on ${placeInText(asking)} from the list?`
          : `Delete the deployment of ${asking?.appName ?? "the app"} on ${placeInText(asking)}?`
      }
      description={
        nothingLeft
          ? `Nothing of ${asking?.appName ?? "it"} is left there, so nothing is removed but the record.`
          : `Ozone first saves a snapshot of its production data to this computer and keeps it. Then it removes the app's containers, its images and its database volume there.${asking?.url == null ? "" : ` People can no longer reach ${asking.url}.`} To bring it back, deploy there again and restore the snapshot under Data.`
      }
      confirmLabel={nothingLeft ? "Remove from the list" : "Delete deployment"}
      destructive
      onConfirm={() => {
        if (asking !== null) void remove(asking);
      }}
    />
  );
  return { ask: setAsking, dialog };
}

/** One place an app is deployed, with its state, and its way out. */
export function DeploymentRow(props: {
  readonly row: OzoneDeploymentRow;
  readonly showApp: boolean;
  readonly working: string | null;
  readonly onDelete: (row: OzoneDeploymentRow) => void;
}) {
  const { row } = props;
  const key = deploymentKey(row);
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <StatusDot
            tone={STATE_TONE[row.state]}
            busy={row.state === "busy" || props.working === key}
            label={stateLine(row)}
          />
          {props.showApp ? row.appName : row.placeLabel}
          {row.projectId === null ? <Badge variant="outline">Deleted app</Badge> : null}
          {row.current ? null : <Badge variant="outline">Earlier place</Badge>}
        </span>
      }
      description={metaLine([
        props.showApp && row.placeLabel,
        row.url?.replace(/^https?:\/\//, ""),
        row.deployedAt !== null &&
          `Deployed ${formatRelativeTimeLabel(row.deployedAt)}${row.commitSha === null ? "" : ` from ${row.commitSha.slice(0, 7)}`}`,
        stateLine(row),
      ])}
      control={
        <Menu>
          <MenuTrigger
            aria-label={`More for ${row.appName} on ${row.placeLabel}`}
            disabled={props.working !== null}
            render={<Button size="icon-xs" variant="ghost" />}
          >
            {props.working === key ? <Spinner /> : <EllipsisIcon />}
          </MenuTrigger>
          <MenuPopup align="end">
            {row.manageUrl === null ? null : (
              <MenuItem render={<a href={row.manageUrl} rel="noreferrer" target="_blank" />}>
                <ExternalLinkIcon />
                Open {row.placeLabel}
              </MenuItem>
            )}
            {row.state === "elsewhere" ? null : (
              <MenuItem
                variant="destructive"
                disabled={!row.removable}
                onClick={() => props.onDelete(row)}
              >
                {row.state === "gone" ? "Remove from the list" : "Delete deployment"}
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      }
    />
  );
}

/** Every app Ozone deployed, where it runs now and where it ran before. */
export function DeployedAppsSection(props: { readonly environmentId: EnvironmentId }) {
  const deployments = useEnvironmentQuery(
    ozoneEnvironment.deployments({ environmentId: props.environmentId, input: {} }),
  );
  const { working, run } = useOzoneCommand();
  const { ask, dialog } = useDeleteDeployment({
    environmentId: props.environmentId,
    run,
    onDeleted: deployments.refresh,
  });
  return (
    <SettingsSection
      title="Deployed apps"
      headerAction={
        <Button size="xs" variant="outline" onClick={deployments.refresh}>
          <RefreshCwIcon />
          Check again
        </Button>
      }
    >
      <SectionRows
        items={deployments.data?.deployments ?? null}
        error={deployments.error}
        onRetry={deployments.refresh}
        loadingLabel="Checking each deployment"
        empty={
          <EmptyRow
            title="Nothing deployed yet"
            description="Apps deployed to this computer, a server or a host are listed here."
          />
        }
      >
        {(rows) =>
          rows.map((row) => (
            <DeploymentRow
              key={deploymentKey(row)}
              row={row}
              showApp
              working={working}
              onDelete={ask}
            />
          ))
        }
      </SectionRows>
      {dialog}
    </SettingsSection>
  );
}
