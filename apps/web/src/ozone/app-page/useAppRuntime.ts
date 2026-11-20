import { runtimePhaseLabel } from "@t3tools/client-runtime/state/ozone";
import type { EnvironmentId, OzoneApp, OzoneRuntimeAction } from "@t3tools/contracts";

import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { phaseTone } from "../appPage.logic";
import { ozoneEnvironment } from "../state";
import { useOzoneCommand } from "../ui/useOzoneCommand";

const VERB: Record<OzoneRuntimeAction, string> = {
  up: "start",
  stop: "stop",
  restart: "restart",
  rebuild: "rebuild",
  migrate: "run the migration of",
};

export const runtimeFailureTitle = (action: OzoneRuntimeAction, appName: string) =>
  `Could not ${VERB[action]} ${appName}`;

/** An app's containers as they are now, and what a person can do to them. */
export function useAppRuntime(app: OzoneApp, environmentId: EnvironmentId) {
  const query = useEnvironmentQuery(
    ozoneEnvironment.runtimeStatus({ environmentId, input: { projectId: app.projectId } }),
  );
  const status = query.data ?? null;
  // A status it already has outranks a later failure to refresh it.
  const error = status === null ? query.error : null;
  const runAction = useAtomCommand(ozoneEnvironment.runtimeAct, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const act = (action: OzoneRuntimeAction) =>
    run(action, runtimeFailureTitle(action, app.name), () =>
      runAction({ environmentId, input: { projectId: app.projectId, action } }),
    );
  const phase = status?.phase;
  return {
    status,
    phase,
    label: error === null ? runtimePhaseLabel(phase) : "Could not check",
    dot: error === null ? phaseTone(phase) : ({ tone: "warning", busy: false } as const),
    error,
    retry: query.refresh,
    working,
    act,
  };
}
