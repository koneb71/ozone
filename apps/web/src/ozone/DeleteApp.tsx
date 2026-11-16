import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { MenuItem } from "~/components/ui/menu";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useAtomCommand } from "~/state/use-atom-command";

import { ozoneEnvironment, refreshApps } from "./state";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useOzoneCommand } from "./ui/useOzoneCommand";

/** Deletes an app after its data is saved, then goes Home. */
function useDeleteApp(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const deleteApp = useAtomCommand(ozoneEnvironment.deleteApp, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const remove = async (app: OzoneApp) => {
    const result = await run("delete", `Could not delete ${app.name}`, () =>
      deleteApp({ environmentId, input: { projectId: app.projectId } }),
    );
    if (result._tag === "Failure") return;
    refreshApps(environmentId);
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

/**
 * Delete app for a menu, with the dialog that confirms it. The dialog goes beside the menu: a
 * menu unmounts its items when it closes.
 */
export function useDeleteAppItem(input: {
  readonly app: OzoneApp;
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
}) {
  const { app } = input;
  const removal = useDeleteApp(input.environmentId);
  const [confirming, setConfirming] = useState(false);
  return {
    item: (
      <MenuItem
        variant="destructive"
        disabled={input.disabled || removal.deleting}
        onClick={() => setConfirming(true)}
      >
        <Trash2Icon />
        Delete app
      </MenuItem>
    ),
    dialog: (
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${app.name}?`}
        description="Its containers and database are removed and its threads leave Ozone. A snapshot of the data is kept, and the folder stays on disk, so Home can bring it back."
        confirmLabel="Delete app"
        destructive
        onConfirm={() => void removal.remove(app)}
      />
    ),
  };
}
