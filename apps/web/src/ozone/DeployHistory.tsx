import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneDeploymentEntry } from "@t3tools/contracts";
import { CheckIcon, CircleAlertIcon, EllipsisIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { deploymentTitle, durationLabel, TRIGGER_LABEL } from "./deploy.logic";
import { ozoneEnvironment } from "./state";

/** Every deploy of the app, newest first, with its output and the way back to it. */
export function DeployHistory(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly busy: boolean;
  readonly onDeployed: () => void;
}) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const history = useEnvironmentQuery(ozoneEnvironment.deployHistory(target));
  const rollback = useAtomCommand(ozoneEnvironment.rollback, { reportFailure: false });
  const [open, setOpen] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const goBack = async (entry: OzoneDeploymentEntry, restoreData: boolean) => {
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        [
          `Deploy "${deploymentTitle(entry)}" again?`,
          restoreData
            ? "Its data comes back too: production's data is replaced by the data as this version left it. A snapshot of today's data is taken first."
            : "Production keeps today's data. If a later version changed the database, this one may not run on it; roll back its data too if so.",
        ].join("\n\n"),
        restoreData ? { variant: "destructive" } : undefined,
      )
      .catch(() => false);
    if (!confirmed) return;
    setWorking(entry.id);
    setError(null);
    const result = await rollback({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, deploymentId: entry.id, restoreData },
    });
    setWorking(null);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "The rollback did not start.");
    }
    history.refresh();
    props.onDeployed();
  };

  const deployments = history.data?.deployments ?? [];
  if (history.data !== null && deployments.length === 0) {
    return <p className="text-muted-foreground text-sm">No deploys yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {error === null ? null : (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/70">
        {deployments.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                {entry.outcome === "running" || working === entry.id ? (
                  <Spinner className="size-4" />
                ) : entry.outcome === "succeeded" ? (
                  <CheckIcon aria-label="Succeeded" className="size-4 text-success" />
                ) : (
                  <CircleAlertIcon aria-label="Failed" className="size-4 text-destructive" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate">{deploymentTitle(entry)}</span>
                  {entry.current ? <Badge variant="success">Running</Badge> : null}
                </span>
                <span className="text-muted-foreground text-xs">
                  {[
                    entry.commitSha?.slice(0, 7),
                    TRIGGER_LABEL[entry.trigger],
                    formatRelativeTimeLabel(entry.startedAt),
                    durationLabel(entry),
                    entry.target.domain ?? entry.target.host ?? "this machine",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {entry.outcome === "failed" && entry.message !== null ? (
                  <span className="line-clamp-2 text-destructive-foreground text-xs">
                    {entry.message}
                  </span>
                ) : null}
              </div>
              <Button
                aria-expanded={open === entry.id}
                aria-label="Show its output"
                size="icon-xs"
                variant="ghost"
                onClick={() => setOpen(open === entry.id ? null : entry.id)}
              >
                <ScrollTextIcon />
              </Button>
              {entry.outcome === "succeeded" && !entry.current ? (
                <Menu>
                  <MenuTrigger
                    aria-label={`Roll back to ${deploymentTitle(entry)}`}
                    disabled={props.busy || working !== null}
                    render={<Button size="icon-xs" variant="ghost" />}
                  >
                    <EllipsisIcon />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem onClick={() => void goBack(entry, false)}>
                      Roll back the code
                    </MenuItem>
                    <MenuItem
                      disabled={entry.dataSnapshotId === null}
                      onClick={() => void goBack(entry, true)}
                    >
                      Roll back the code and its data
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              ) : null}
            </div>
            {open === entry.id ? (
              <DeployOutput
                app={props.app}
                deploymentId={entry.id}
                environmentId={props.environmentId}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeployOutput(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deploymentId: string;
}) {
  const output = useEnvironmentQuery(
    ozoneEnvironment.deployOutput({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, deploymentId: props.deploymentId },
    }),
  );
  if (output.error !== null) return <p className="text-muted-foreground text-xs">{output.error}</p>;
  if (output.data === null) return <Spinner className="size-4" />;
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2 font-mono text-2xs leading-4">
      {output.data.text}
    </pre>
  );
}
