import type { EnvironmentId, OzoneApp, OzoneSnapshot } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { formatBytes } from "~/lib/formatBytes";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { metaLine } from "../appPage.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { useOzoneCommand } from "../ui/useOzoneCommand";

const REASON_LABEL: Record<OzoneSnapshot["reason"], string> = {
  manual: "Backed up by you",
  task: "After a build task passed",
  "before-rebuild": "Before a rebuild",
  "before-restore": "Before a restore",
  "before-delete": "Before deleting data",
  "before-migrate": "Before a migration",
  "before-deploy": "Before a deploy",
};

/** The app's snapshots, while building and deployed: take one, or put one back. */
export function DataSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deployed: boolean;
}) {
  return (
    <SettingsPageContainer>
      <Snapshots {...props} production={false} />
      {props.deployed ? <Snapshots {...props} production /> : null}
    </SettingsPageContainer>
  );
}

function Snapshots(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly production: boolean;
}) {
  const target = {
    environmentId: props.environmentId,
    input: {
      projectId: props.app.projectId,
      ...(props.production ? { production: true } : {}),
    },
  };
  const snapshots = useEnvironmentQuery(ozoneEnvironment.snapshots(target));
  const takeSnapshot = useAtomCommand(ozoneEnvironment.takeSnapshot, { reportFailure: false });
  const restoreSnapshot = useAtomCommand(ozoneEnvironment.restoreSnapshot, {
    reportFailure: false,
  });
  const { working, run } = useOzoneCommand();
  const [restoring, setRestoring] = useState<OzoneSnapshot | null>(null);

  const backUp = async () => {
    await run("backup", "Could not back up the data", () => takeSnapshot(target));
    snapshots.refresh();
  };
  const restore = async (snapshot: OzoneSnapshot) => {
    await run(snapshot.id, "Could not restore the data", () =>
      restoreSnapshot({
        environmentId: props.environmentId,
        input: { ...target.input, snapshotId: snapshot.id },
      }),
    );
    snapshots.refresh();
  };

  return (
    <SettingsSection
      title={props.production ? "Production" : "While building"}
      headerAction={
        <Button
          disabled={working !== null}
          size="xs"
          variant="outline"
          onClick={() => void backUp()}
        >
          {working === "backup" ? <Spinner /> : <PlusIcon />}
          Back up now
        </Button>
      }
    >
      <SectionRows
        items={snapshots.data?.snapshots ?? null}
        error={snapshots.error}
        loadingLabel="Loading snapshots"
        empty={
          <EmptyRow
            title="No snapshots yet"
            description={
              props.production
                ? "Every deploy after the first takes one before its migrations run."
                : "One is taken after every build task that passes."
            }
          />
        }
      >
        {(list) =>
          list.map((snapshot) => (
            <SettingsRow
              key={snapshot.id}
              title={snapshot.label ?? REASON_LABEL[snapshot.reason]}
              description={metaLine([
                formatRelativeTimeLabel(snapshot.createdAt),
                formatBytes(snapshot.sizeBytes),
                snapshot.commitSha === null ? null : `commit ${snapshot.commitSha.slice(0, 7)}`,
              ])}
              control={
                <Button
                  disabled={working !== null}
                  size="xs"
                  variant="ghost"
                  onClick={() => setRestoring(snapshot)}
                >
                  {working === snapshot.id ? <Spinner /> : null}
                  Restore
                </Button>
              }
            />
          ))
        }
      </SectionRows>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
        title={`Restore the data from ${restoring === null ? "then" : formatRelativeTimeLabel(restoring.createdAt)}?`}
        description={
          props.production
            ? "The data people use now is backed up first, then replaced. The deployed app stops while it happens."
            : "The data the app has now is backed up first, then replaced. The app restarts."
        }
        confirmLabel="Restore"
        destructive
        onConfirm={() => {
          if (restoring !== null) void restore(restoring);
        }}
      />
    </SettingsSection>
  );
}
