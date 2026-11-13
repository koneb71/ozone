import type { EnvironmentId, OzoneApp, OzoneDeploymentEntry } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
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
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { deploymentTone, metaLine } from "../appPage.logic";
import { deploymentTitle, durationLabel, TRIGGER_LABEL } from "../deploy.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { OutputView } from "../ui/OutputView";
import { StatusDot } from "../ui/StatusDot";
import { useOzoneCommand } from "../ui/useOzoneCommand";

interface Rollback {
  readonly entry: OzoneDeploymentEntry;
  readonly restoreData: boolean;
}

/** Every deploy, newest first, with what it printed and the way back to it. */
export function DeploymentsSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const history = useEnvironmentQuery(ozoneEnvironment.deployHistory(target));
  const rollback = useAtomCommand(ozoneEnvironment.rollback, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [output, setOutput] = useState<OzoneDeploymentEntry | null>(null);
  const [chosen, setChosen] = useState<Rollback | null>(null);
  const running = history.data?.deployments.some((entry) => entry.outcome === "running") ?? false;

  const goBack = async ({ entry, restoreData }: Rollback) => {
    await run(entry.id, "Could not roll back", () =>
      rollback({
        environmentId: props.environmentId,
        input: { projectId: props.app.projectId, deploymentId: entry.id, restoreData },
      }),
    );
    history.refresh();
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Deployments">
        <SectionRows
          items={history.data?.deployments ?? null}
          error={history.error}
          loadingLabel="Loading deployments"
          empty={
            <EmptyRow
              title="No deploys yet"
              description="Each deploy is kept here with its output."
            />
          }
        >
          {(entries) =>
            entries.map((entry) => (
              <SettingsRow
                key={entry.id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot {...deploymentTone(entry.outcome)} label={entry.outcome} />
                    <span className="truncate">{deploymentTitle(entry)}</span>
                    {entry.current ? <Badge variant="success">Live</Badge> : null}
                  </span>
                }
                description={
                  <>
                    <span>
                      {metaLine([
                        entry.commitSha === null ? null : entry.commitSha.slice(0, 7),
                        TRIGGER_LABEL[entry.trigger],
                        formatRelativeTimeLabel(entry.startedAt),
                        durationLabel(entry),
                        entry.target.domain ??
                          (entry.target.dokploy !== null
                            ? "Dokploy"
                            : entry.target.hosted !== null
                              ? "a hosting platform"
                              : entry.target.host === null
                                ? "this computer"
                                : entry.target.host),
                      ])}
                    </span>
                    {entry.outcome === "failed" && entry.message !== null ? (
                      <span className="mt-0.5 line-clamp-2 block text-destructive-foreground">
                        {entry.message}
                      </span>
                    ) : null}
                  </>
                }
                control={
                  <div className="flex items-center gap-1">
                    {working === entry.id ? <Spinner size="sm" tone="muted" /> : null}
                    <Button size="xs" variant="ghost" onClick={() => setOutput(entry)}>
                      Output
                    </Button>
                    <Menu>
                      <MenuTrigger
                        aria-label={`More for ${deploymentTitle(entry)}`}
                        render={<Button size="icon-xs" variant="ghost" />}
                      >
                        <EllipsisIcon />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem
                          disabled={
                            entry.current ||
                            entry.outcome !== "succeeded" ||
                            running ||
                            working !== null
                          }
                          onClick={() => setChosen({ entry, restoreData: false })}
                        >
                          Roll back to this version
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          variant="destructive"
                          disabled={
                            entry.current ||
                            entry.dataSnapshotId === null ||
                            running ||
                            working !== null
                          }
                          onClick={() => setChosen({ entry, restoreData: true })}
                        >
                          Roll back with its data
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </div>
                }
              />
            ))
          }
        </SectionRows>
      </SettingsSection>

      {output === null ? null : (
        <DeployOutputDialog
          app={props.app}
          environmentId={props.environmentId}
          entry={output}
          onClose={() => setOutput(null)}
        />
      )}
      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(open) => {
          if (!open) setChosen(null);
        }}
        title={`Roll back to "${chosen === null ? "" : deploymentTitle(chosen.entry)}"?`}
        description={
          chosen?.restoreData === true
            ? "Production's data is replaced by the data as this version left it. A snapshot of today's data is taken first."
            : "Production keeps today's data. If a later version changed the database, this one may not run on it."
        }
        confirmLabel={chosen?.restoreData === true ? "Roll back with data" : "Roll back"}
        destructive={chosen?.restoreData === true}
        onConfirm={() => {
          if (chosen !== null) void goBack(chosen);
        }}
      />
    </SettingsPageContainer>
  );
}

function DeployOutputDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly entry: OzoneDeploymentEntry;
  readonly onClose: () => void;
}) {
  const output = useEnvironmentQuery(
    ozoneEnvironment.deployOutput({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, deploymentId: props.entry.id },
    }),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{deploymentTitle(props.entry)}</DialogTitle>
          <DialogDescription>
            {metaLine([
              props.entry.commitSha?.slice(0, 7),
              formatRelativeTimeLabel(props.entry.startedAt),
              durationLabel(props.entry),
            ])}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <OutputView
            text={output.error ?? output.data?.text ?? null}
            placeholder="Loading the output"
            size="tall"
            label="Deploy output"
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
