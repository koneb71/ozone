import {
  latestThreadByProject,
  runtimePhaseLabel,
  type RuntimePhaseLabel,
} from "@t3tools/client-runtime/state/ozone";
import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusPill } from "../components/StatusPill";
import { AppText as Text } from "../components/ui/AppText";
import * as Dialog from "../components/ui/Dialog";
import { NavigationRow } from "../components/ui/NavigationRow";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { useSettingsEnvironmentMenu } from "../features/settings/components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { SettingsSection } from "../features/settings/components/SettingsSection";
import {
  useSettingsEnvironmentFilter,
  type SettingsTarget,
} from "../features/settings/settings-environment-filter";
import { useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { ozoneEnvironment } from "./state";

const PILL: Record<
  RuntimePhaseLabel["tone"],
  { readonly pillClassName: string; readonly textClassName: string }
> = {
  success: {
    pillClassName: "bg-adaptive-emerald-500-a12-a16",
    textClassName: "text-adaptive-emerald-700-300",
  },
  info: { pillClassName: "bg-update", textClassName: "text-update-foreground" },
  warning: { pillClassName: "bg-warning", textClassName: "text-warning-foreground" },
  error: { pillClassName: "bg-danger", textClassName: "text-danger-foreground" },
  outline: { pillClassName: "bg-subtle", textClassName: "text-foreground-secondary" },
};

/** The apps Ozone runs on each connected computer. A row opens the app's latest thread. */
export function OzoneAppsScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const environmentMenu = useSettingsEnvironmentMenu();
  return (
    <SettingsScreen title="Apps" menus={[environmentMenu]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {selectedTargets.length === 0 ? (
          <Text className="px-2 text-base text-foreground-muted">
            Connect to a computer that runs Ozone to see its apps.
          </Text>
        ) : (
          selectedTargets.map((environment) => (
            <EnvironmentApps key={environment.environmentId} environment={environment} />
          ))
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function EnvironmentApps({ environment }: { readonly environment: SettingsTarget }) {
  const environmentId = environment.environmentId;
  const apps = useEnvironmentQuery(ozoneEnvironment.apps({ environmentId, input: {} }));
  const latestThreads = latestThreadByProject(useThreadShells(), environmentId);
  const selectDetail = useSelectWorkspaceDetail();
  return (
    <SettingsSection title={environment.label}>
      {apps.error ? (
        <Text className="p-4 text-base text-danger-foreground">{apps.error}</Text>
      ) : !apps.data ? (
        <Text className="p-4 text-base text-foreground-muted">Loading apps…</Text>
      ) : apps.data.apps.length === 0 ? (
        <Text className="p-4 text-base text-foreground-muted">
          No apps yet. Describe one in Ozone on this computer.
        </Text>
      ) : (
        apps.data.apps.map((app, index) => (
          <AppRow
            key={app.projectId}
            app={app}
            environmentId={environmentId}
            separated={index > 0}
            onOpen={() => {
              const thread = latestThreads.get(app.projectId);
              if (thread === undefined) {
                Dialog.alert(app.name, "This app has no thread yet. Start one in Ozone.");
                return;
              }
              selectDetail({
                name: "Thread",
                params: { environmentId: String(environmentId), threadId: String(thread.id) },
              });
            }}
          />
        ))
      )}
    </SettingsSection>
  );
}

function AppRow(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly separated: boolean;
  readonly onOpen: () => void;
}) {
  const status = useEnvironmentQuery(
    ozoneEnvironment.runtimeStatus({
      environmentId: props.environmentId,
      input: { projectId: props.app.projectId },
    }),
  ).data;
  const phase = runtimePhaseLabel(status?.phase);
  return (
    <NavigationRow
      title={props.app.name}
      subtitle={`localhost:${props.app.port}`}
      className={props.separated ? "border-t border-border-subtle" : undefined}
      trailing={<StatusPill label={phase.label} {...PILL[phase.tone]} size="compact" />}
      onPress={props.onOpen}
    />
  );
}
