import type { EnvironmentId, OzoneAppConfigureInput, ProjectId } from "@t3tools/contracts";

import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment, refreshApps } from "./state";
import { useOzoneCommand } from "./ui/useOzoneCommand";

/** Saves a change to an app's settings, then refreshes the list that carries them. */
export function useConfigureApp() {
  const configureApp = useAtomCommand(ozoneEnvironment.configureApp, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const save = async (
    target: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
    settings: OzoneAppConfigureInput["settings"],
  ) => {
    const result = await run("save", "Could not save the setting", () =>
      configureApp({
        environmentId: target.environmentId,
        input: { projectId: target.projectId, settings },
      }),
    );
    if (result._tag === "Success") refreshApps(target.environmentId);
  };
  return { saving: working !== null, save };
}
