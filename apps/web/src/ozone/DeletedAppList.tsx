import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneDeletedApp } from "@t3tools/contracts";
import { ArchiveRestoreIcon } from "lucide-react";
import { useState } from "react";

import { DiscoveryList, DiscoveryListRow } from "~/components/ui/discovery-list";
import { Spinner } from "~/components/ui/spinner";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { ozoneEnvironment } from "./state";

/** Deleted apps whose folder and snapshots are still there. Choosing one brings it back. */
export function DeletedAppList(props: {
  readonly apps: ReadonlyArray<OzoneDeletedApp>;
  readonly environmentId: EnvironmentId;
}) {
  const restoreApp = useAtomCommand(ozoneEnvironment.restoreApp, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const [restoring, setRestoring] = useState<string | null>(null);

  const bringBack = async (app: OzoneDeletedApp) => {
    setRestoring(app.slug);
    const result = await restoreApp({
      environmentId: props.environmentId,
      input: { slug: app.slug },
    });
    setRestoring(null);
    appAtomRegistry.refresh(
      ozoneEnvironment.apps({ environmentId: props.environmentId, input: {} }),
    );
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not bring back ${app.name}`,
          description: error instanceof Error ? error.message : undefined,
        }),
      );
      return;
    }
    // Its old threads went with the delete, so it opens on a new one.
    void handleNewThread(scopeProjectRef(props.environmentId, result.value.app.projectId));
  };

  return (
    <DiscoveryList>
      {props.apps.map((app) => (
        <DiscoveryListRow
          key={app.slug}
          disabled={restoring !== null}
          icon={
            restoring === app.slug ? (
              <Spinner className="size-4 shrink-0" />
            ) : (
              <ArchiveRestoreIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            )
          }
          title={app.name}
          description={
            app.deletedAt === null
              ? "Deleted. Its code and last snapshot are kept."
              : `Deleted ${formatRelativeTimeLabel(app.deletedAt)}. Its code and last snapshot are kept.`
          }
          action={<span className="shrink-0 text-muted-foreground text-xs">Bring back</span>}
          onClick={() => void bringBack(app)}
        />
      ))}
    </DiscoveryList>
  );
}
