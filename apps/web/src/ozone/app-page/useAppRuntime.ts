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

/** An app's containers as they are now, and what a person can do to them. */
export function useAppRuntime(app: OzoneApp, environmentId: EnvironmentId) {
  const status =
    useEnvironmentQuery(
      ozoneEnvironment.runtimeStatus({ environmentId, input: { projectId: app.projectId } }),
    ).data ?? null;
  const runAction = useAtomCommand(ozoneEnvironment.runtimeAct, { reportFailure: false });
  const { working, run } = useOzoneCommand();
  const act = (action: OzoneRuntimeAction) =>
    run(action, `Could not ${VERB[action]} ${app.name}`, () =>
      runAction({ environmentId, input: { projectId: app.projectId, action } }),
    );
  const phase = status?.phase;
  return {
    status,
    phase,
    label: runtimePhaseLabel(phase),
    dot: phaseTone(phase),
    working,
    act,
  };
}
