import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OzoneApp, OzoneAppConfigureInput } from "@t3tools/contracts";

import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { isProviderInstancePickerReady, providerInstanceEntriesFor } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "../state";
import { useOzoneCommand } from "../ui/useOzoneCommand";

/** How the app's builds run, from now on. */
export function BuildSection(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly deployed: boolean;
}) {
  const { app, environmentId } = props;
  const configureApp = useAtomCommand(ozoneEnvironment.configureApp, { reportFailure: false });
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const { working, run } = useOzoneCommand();
  const saving = working !== null;

  const save = async (change: OzoneAppConfigureInput["settings"]) => {
    const result = await run("save", "Could not save the setting", () =>
      configureApp({ environmentId, input: { projectId: app.projectId, settings: change } }),
    );
    if (result._tag === "Success") {
      appAtomRegistry.refresh(ozoneEnvironment.apps({ environmentId, input: {} }));
    }
  };

  const instanceEntries = providerInstanceEntriesFor(providers, settings, app.projectId);
  const chosen = app.settings.workerModel;
  const activeInstanceId =
    chosen?.providerInstanceId ?? instanceEntries.find(isProviderInstancePickerReady)?.instanceId;
  // Empty when none is chosen, so the list ticks no model.
  const activeModel = chosen?.model ?? "";

  return (
    <SettingsPageContainer>
      <SettingsSection title="Builds">
        <SettingsRow
          title="Show me the plan first"
          description="The lead waits for you to start its plan, so you can change it."
          control={
            <Switch
              aria-label="Show me the plan first"
              checked={app.settings.reviewPlans}
              disabled={saving}
              onCheckedChange={(checked) => void save({ reviewPlans: checked })}
            />
          }
        />
        <SettingsRow
          title="Try the finished app in a browser"
          description="When every check passes, a tester uses the app against what you asked for."
          control={
            <Switch
              aria-label="Try the finished app in a browser"
              checked={app.settings.verifyBuilds}
              disabled={saving}
              onCheckedChange={(checked) => void save({ verifyBuilds: checked })}
            />
          }
        />
        <SettingsRow
          title="Deploy when a build completes"
          description={
            props.deployed
              ? "The new version goes where the app was last deployed."
              : "Deploy the app once to turn this on."
          }
          control={
            <Switch
              aria-label="Deploy when a build completes"
              checked={app.settings.deployOnBuild}
              disabled={saving || !props.deployed}
              onCheckedChange={(checked) => void save({ deployOnBuild: checked })}
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Models">
        <SettingsRow
          title="Workers and the tester"
          description="The lead keeps its thread's model. A smaller model here makes builds cheaper."
          control={
            activeInstanceId === undefined ? (
              <span className="text-muted-foreground text-sm">No provider is ready</span>
            ) : (
              <div className="flex items-center gap-1">
                {chosen === null ? null : (
                  <Button
                    disabled={saving}
                    size="xs"
                    variant="ghost"
                    onClick={() => void save({ workerModel: null })}
                  >
                    Use the lead's
                  </Button>
                )}
                <ProviderModelPicker
                  environmentId={environmentId}
                  disabled={saving}
                  activeInstanceId={activeInstanceId}
                  model={activeModel}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={getCustomModelOptionsByInstance(
                    settings,
                    providers,
                    activeInstanceId,
                    activeModel,
                  )}
                  isComposerOwned={false}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(chosen === null ? { triggerLabel: "Same as the lead" } : {})}
                  onInstanceModelChange={(providerInstanceId, model) =>
                    void save({ workerModel: { providerInstanceId, model } })
                  }
                />
              </div>
            )
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
