import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp, OzoneAppConfigureInput } from "@t3tools/contracts";
import { useState } from "react";

import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "~/components/settings/settingsLayout";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { isProviderInstancePickerReady, providerInstanceEntriesFor } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "./state";

/** How an app's builds run: whether the plan waits for the person, the browser test, the model. */
export function AppBuildSettingsDialog(props: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        {props.open ? <BuildSettings app={props.app} environmentId={props.environmentId} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function BuildSettings({
  app,
  environmentId,
}: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
}) {
  const configureApp = useAtomCommand(ozoneEnvironment.configureApp, { reportFailure: false });
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (change: OzoneAppConfigureInput["settings"]) => {
    setSaving(true);
    setError(null);
    const result = await configureApp({
      environmentId,
      input: { projectId: app.projectId, settings: change },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not save the setting.");
      return;
    }
    appAtomRegistry.refresh(ozoneEnvironment.apps({ environmentId, input: {} }));
  };

  const instanceEntries = providerInstanceEntriesFor(providers, settings, app.projectId);
  const chosen = app.settings.workerModel;
  const activeInstanceId =
    chosen?.providerInstanceId ?? instanceEntries.find(isProviderInstancePickerReady)?.instanceId;
  // Empty when none is chosen, so the list ticks no model.
  const activeModel = chosen?.model ?? "";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Build settings</DialogTitle>
        <DialogDescription>How {app.name} is built from now on.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ozone-review-plans">Show me the plan before building</Label>
              <p className="text-muted-foreground text-sm">
                The lead waits for you to start its plan, so you can change it first.
              </p>
            </div>
            <Switch
              id="ozone-review-plans"
              checked={app.settings.reviewPlans}
              disabled={saving}
              onCheckedChange={(checked) => void save({ reviewPlans: checked })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ozone-verify-builds">Try the finished app in a browser</Label>
              <p className="text-muted-foreground text-sm">
                When every check passes, a tester uses the app against what you asked for.
              </p>
            </div>
            <Switch
              id="ozone-verify-builds"
              checked={app.settings.verifyBuilds}
              disabled={saving}
              onCheckedChange={(checked) => void save({ verifyBuilds: checked })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-sm">Model for workers and the tester</span>
              <p className="text-muted-foreground text-sm">
                The lead keeps the model of its thread. A smaller model here makes builds cheaper.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeInstanceId === undefined ? (
                <span className="text-muted-foreground text-sm">No provider is ready.</span>
              ) : (
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
              )}
              {chosen === null ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => void save({ workerModel: null })}
                >
                  Use the lead's model
                </Button>
              )}
            </div>
          </div>
          {error === null ? null : (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </DialogPanel>
    </>
  );
}
