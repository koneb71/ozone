import type { EnvironmentId, OzoneApp, OzoneHistoryEntry } from "@t3tools/contracts";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { metaLine } from "../appPage.logic";
import { ozoneEnvironment } from "../state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyRow, SectionRows } from "../ui/SectionRows";
import { useOzoneCommand } from "../ui/useOzoneCommand";

/** Every build task that passed: a point to take the code, and its data, back to. */
export function HistorySection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  const target = { environmentId: props.environmentId, input: { projectId: props.app.projectId } };
  const history = useEnvironmentQuery(ozoneEnvironment.history(target));
  const restoreHistory = useAtomCommand(ozoneEnvironment.restoreHistory, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const [chosen, setChosen] = useState<OzoneHistoryEntry | null>(null);

  const restore = async (entry: OzoneHistoryEntry) => {
    await run(entry.sha, "Could not go back to that point", () =>
      restoreHistory({
        environmentId: props.environmentId,
        input: { projectId: props.app.projectId, sha: entry.sha },
      }),
    );
    history.refresh();
    appAtomRegistry.refresh(ozoneEnvironment.snapshots(target));
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="History">
        <SectionRows
          items={history.data?.entries ?? null}
          error={history.error}
          loadingLabel="Loading history"
          empty={
            <EmptyRow
              title="No history yet"
              description="Each build task that passes adds a point here."
            />
          }
        >
          {(entries) =>
            entries.map((entry, index) => (
              <SettingsRow
                key={entry.sha}
                title={entry.subject}
                description={metaLine([
                  formatRelativeTimeLabel(entry.committedAt),
                  entry.sha.slice(0, 7),
                  entry.snapshot === null ? "code only" : "code and data",
                ])}
                control={
                  index === 0 ? (
                    <Badge variant="outline">Current</Badge>
                  ) : (
                    <Button
                      disabled={working !== null}
                      size="xs"
                      variant="ghost"
                      onClick={() => setChosen(entry)}
                    >
                      {working === entry.sha ? <Spinner /> : null}
                      Go back here
                    </Button>
                  )
                }
              />
            ))
          }
        </SectionRows>
      </SettingsSection>
      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(open) => {
          if (!open) setChosen(null);
        }}
        title={`Go back to "${chosen?.subject ?? ""}"?`}
        description={
          chosen?.snapshot === null
            ? "The code goes back to that point; the data stays as it is. What the app has now stays in its history, and it restarts."
            : "The code and the data go back to that point. What the app has now stays in its history, and it restarts."
        }
        confirmLabel="Go back"
        destructive
        onConfirm={() => {
          if (chosen !== null) void restore(chosen);
        }}
      />
    </SettingsPageContainer>
  );
}
