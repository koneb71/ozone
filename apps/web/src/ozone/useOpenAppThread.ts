import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { latestThreadByProject } from "@t3tools/client-runtime/state/ozone";
import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

/** Opens an app's latest thread, or a new one when it has none. */
export function useOpenAppThread(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const latestThreads = latestThreadByProject(useThreadShells(), environmentId);
  const latestOf = (app: OzoneApp) => latestThreads.get(app.projectId) ?? null;
  const open = (app: OzoneApp) => {
    const latest = latestOf(app);
    if (latest === null) {
      void handleNewThread(scopeProjectRef(environmentId, app.projectId));
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, latest.id)),
    });
  };
  return { open, latestOf };
}
