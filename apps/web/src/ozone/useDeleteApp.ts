import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment } from "./state";
import { useOzoneCommand } from "./ui/useOzoneCommand";

export const DELETE_APP_DESCRIPTION =
  "Its containers and database are removed and its threads leave Ozone. A snapshot of the data is kept, and the folder stays on disk, so Home can bring it back.";

/** Deletes an app after its data is saved, then goes Home. */
export function useDeleteApp(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const deleteApp = useAtomCommand(ozoneEnvironment.deleteApp, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const remove = async (app: OzoneApp) => {
    const result = await run("delete", `Could not delete ${app.name}`, () =>
      deleteApp({ environmentId, input: { projectId: app.projectId } }),
    );
    if (result._tag === "Failure") return;
    appAtomRegistry.refresh(ozoneEnvironment.apps({ environmentId, input: {} }));
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `${app.name} is deleted`,
        description: `Its folder is still at ${result.value.workspaceRoot}.`,
      }),
    );
    await navigate({ to: "/" });
  };
  return { deleting: working !== null, remove };
}
