import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneHistoryEntry } from "@t3tools/contracts";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { ensureLocalApi } from "~/localApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { ozoneEnvironment } from "./state";

/** An app's commits, and the way back to any of them with the data it had then. */
export function AppHistoryDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        {props.open ? <AppHistory app={props.app} environmentId={props.environmentId} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function AppHistory(props: { readonly app: OzoneApp; readonly environmentId: EnvironmentId }) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const history = useEnvironmentQuery(ozoneEnvironment.history(target));
  const restoreHistory = useAtomCommand(ozoneEnvironment.restoreHistory, {
    reportFailure: false,
  });
  /** The commit being restored. */
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (entry: OzoneHistoryEntry) => {
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        [
          `Take ${props.app.name} back to "${entry.subject}" from ${formatRelativeTimeLabel(entry.committedAt)}?`,
          entry.snapshot === null
            ? "Its code goes back to that point. Its data stays as it is: no snapshot was taken then."
            : "Its code and its data go back to that point.",
          "What it has now is kept in its history, so you can come back to it. The app restarts.",
        ].join("\n"),
        { variant: "destructive" },
      )
      .catch(() => false);
    if (!confirmed) return;
    setWorking(entry.sha);
    setError(null);
    const result = await restoreHistory({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, sha: entry.sha },
    });
    setWorking(null);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not restore that point.");
    }
    history.refresh();
    appAtomRegistry.refresh(ozoneEnvironment.snapshots(target));
  };

  const entries = history.data?.entries ?? [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.app.name} history</DialogTitle>
        <DialogDescription>
          Every build task that passed is a point to come back to, with a snapshot of the data taken
          right after it.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-3">
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {entries.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {history.isPending ? "Reading the history." : "No history yet."}
            </p>
          ) : (
            <ul className="m-0 flex max-h-[50dvh] list-none flex-col divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70 p-0">
              {entries.map((entry, index) => (
                <li key={entry.sha} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-foreground text-sm">
                      {entry.subject}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {[
                        formatRelativeTimeLabel(entry.committedAt),
                        entry.sha.slice(0, 7),
                        entry.snapshot === null ? "code only" : "code and data",
                      ].join(" · ")}
                    </span>
                  </div>
                  {index === 0 ? (
                    <Badge variant="outline">Now</Badge>
                  ) : (
                    <Button
                      disabled={working !== null}
                      size="xs"
                      variant="outline"
                      onClick={() => void restore(entry)}
                    >
                      {working === entry.sha ? <Spinner /> : null}
                      Go back here
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogPanel>
    </>
  );
}
