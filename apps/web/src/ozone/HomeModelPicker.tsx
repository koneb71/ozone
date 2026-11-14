import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";

import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "~/providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";

/** The model Home's next build or chat starts on. Null means the default a new thread gets. */
export function HomeModelPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly value: ModelSelection | null;
  readonly disabled: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const { environmentId } = props;
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const shown =
    props.value ??
    (settings.defaultModelSelection === null
      ? resolveProjectDefaultProviderModelSelection(providers, settings, null)
      : resolveDefaultProviderModelSelection(providers, settings.defaultModelSelection));
  // With no provider ready there is nothing to choose, and starting says how to set one up.
  if (shown === null) return null;

  return (
    <ProviderModelPicker
      environmentId={environmentId}
      disabled={props.disabled}
      activeInstanceId={shown.instanceId}
      model={shown.model}
      lockedProvider={null}
      instanceEntries={providerInstanceEntriesFor(providers, settings, null)}
      modelOptionsByInstance={getCustomModelOptionsByInstance(
        settings,
        providers,
        shown.instanceId,
        shown.model,
      )}
      isComposerOwned={false}
      compact
      popupAlign="end"
      onInstanceModelChange={(instanceId, model) => props.onChange({ instanceId, model })}
    />
  );
}
