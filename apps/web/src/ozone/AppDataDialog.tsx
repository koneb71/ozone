import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneSnapshot } from "@t3tools/contracts";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { formatBytes } from "~/lib/formatBytes";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { ozoneEnvironment } from "./state";

const REASON_LABEL: Record<OzoneSnapshot["reason"], string> = {
  manual: "Backed up by you",
  task: "After a build task passed",
  "before-rebuild": "Before a rebuild",
  "before-restore": "Before a restore",
  "before-delete": "Before deleting data",
  "before-migrate": "Before a migration",
  "before-deploy": "Before a deploy",
};

/** An app's snapshots: take one, or put one back. */
export function AppDataDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        {props.open ? <AppData app={props.app} environmentId={props.environmentId} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function AppData(props: { readonly app: OzoneApp; readonly environmentId: EnvironmentId }) {
  const app = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  // Production's data is offered once the app has been deployed.
  const deployed = useEnvironmentQuery(ozoneEnvironment.deployStatus(app)).data;
  const hasProduction = deployed !== null && deployed !== undefined && deployed.target !== null;
  const [production, setProduction] = useState(false);
  const target = production
    ? { ...app, input: { projectId: props.app.projectId, production: true } }
    : app;
  const snapshots = useEnvironmentQuery(ozoneEnvironment.snapshots(target));
  const takeSnapshot = useAtomCommand(ozoneEnvironment.takeSnapshot, { reportFailure: false });
  const restoreSnapshot = useAtomCommand(ozoneEnvironment.restoreSnapshot, {
    reportFailure: false,
  });
  /** "backup", or the id of the snapshot being restored. */
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settle = (failure: unknown, fallback: string) => {
    setWorking(null);
    setError(failure === null ? null : failure instanceof Error ? failure.message : fallback);
    snapshots.refresh();
  };

  const backUp = async () => {
    setWorking("backup");
    const result = await takeSnapshot(target);
    settle(
      result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
      "Could not back up the data.",
    );
  };

  const restore = async (snapshot: OzoneSnapshot) => {
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        [
          production
            ? `Restore the deployed ${props.app.name}'s data from ${formatRelativeTimeLabel(snapshot.createdAt)}?`
            : `Restore ${props.app.name}'s data from ${formatRelativeTimeLabel(snapshot.createdAt)}?`,
          production
            ? "The data people are using now is backed up first, then replaced. The deployed app stops while it happens."
            : "The data it has now is backed up first, then replaced. The app restarts.",
        ].join("\n"),
        { variant: "destructive" },
      )
      .catch(() => false);
    if (!confirmed) return;
    setWorking(snapshot.id);
    const result = await restoreSnapshot({
      environmentId: props.environmentId,
      input: { ...target.input, snapshotId: snapshot.id },
    });
    settle(
      result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
      "Could not restore the data.",
    );
  };

  const list = snapshots.data?.snapshots ?? [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.app.name} data</DialogTitle>
        <DialogDescription>
          {production
            ? "Copies of the deployed app's database, kept on this machine. Every deploy takes one before its migrations run."
            : "Snapshots are copies of the database, kept outside the app's folder. Stopping, restarting and rebuilding the app never touch its data."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          {hasProduction ? (
            <ToggleGroup
              aria-label="Whose data"
              disabled={working !== null}
              value={[production ? "production" : "development"]}
              onValueChange={(next) => {
                if (next[0] === undefined) return;
                setProduction(next[0] === "production");
                setError(null);
              }}
            >
              <Toggle value="development">While building</Toggle>
              <Toggle value="production">Deployed</Toggle>
            </ToggleGroup>
          ) : null}
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {list.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {snapshots.isPending ? "Reading the snapshots." : "No snapshots yet."}
            </p>
          ) : (
            <ul className="m-0 flex max-h-[50dvh] list-none flex-col divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70 p-0">
              {list.map((snapshot) => (
                <li key={snapshot.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-foreground text-sm">
                      {snapshot.label ?? REASON_LABEL[snapshot.reason]}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {[
                        formatRelativeTimeLabel(snapshot.createdAt),
                        formatBytes(snapshot.sizeBytes),
                        snapshot.commitSha === null
                          ? null
                          : `commit ${snapshot.commitSha.slice(0, 7)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <Button
                    disabled={working !== null}
                    size="xs"
                    variant="outline"
                    onClick={() => void restore(snapshot)}
                  >
                    {working === snapshot.id ? <Spinner /> : null}
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button disabled={working !== null} onClick={() => void backUp()}>
          {working === "backup" ? <Spinner /> : null}
          Back up now
        </Button>
      </DialogFooter>
    </>
  );
}
