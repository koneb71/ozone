import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";

import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useEnvironmentQuery } from "~/state/query";

import { ozoneEnvironment } from "../state";
import { OutputView } from "../ui/OutputView";

const LOG_LINES = 300;

/** The recent output of the app and its database. */
export function LogsSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  const logs = useEnvironmentQuery(
    ozoneEnvironment.runtimeLogs({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId, tail: LOG_LINES },
    }),
  );
  return (
    <SettingsPageContainer width="wide">
      <SettingsSection
        title={`Last ${LOG_LINES} lines`}
        variant="plain"
        headerAction={
          <Button size="xs" variant="outline" onClick={logs.refresh}>
            <RefreshIcon refreshing={logs.isPending} />
            Refresh
          </Button>
        }
      >
        <OutputView
          text={logs.error ?? logs.data?.text ?? null}
          placeholder={logs.isPending ? "Loading logs" : "The app has printed nothing yet."}
          size="tall"
          label="Logs"
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
