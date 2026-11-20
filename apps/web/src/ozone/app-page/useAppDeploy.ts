import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OzoneApp } from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { deployActionOf, isDeployable } from "../deploy.logic";
import { ozoneEnvironment } from "../state";
import { useOzoneCommand } from "../ui/useOzoneCommand";
import { useOpenAppPage } from "./navigation";

/**
 * An app's production as it is now and the one button that changes it. The app's page holds a
 * single instance, so its header and its sections agree on what is running.
 */
export function useAppDeploy(app: OzoneApp | null, environmentId: EnvironmentId) {
  const query = useEnvironmentQuery(
    app === null
      ? null
      : ozoneEnvironment.deployStatus({ environmentId, input: { projectId: app.projectId } }),
  );
  const phase = useEnvironmentQuery(
    app === null
      ? null
      : ozoneEnvironment.runtimeStatus({ environmentId, input: { projectId: app.projectId } }),
  ).data?.phase;
  const redeploy = useAtomCommand(ozoneEnvironment.redeploy, { reportFailure: false });
  const { working, run: runOne } = useOzoneCommand();
  const openPage = useOpenAppPage();
  const status = query.data;
  const refresh = query.refresh;
  const busy = working !== null || status?.state === "deploying";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server's deploy status, which names the step that runs, while a deploy is under way
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const run = async <A, E>(
    key: string,
    failureTitle: string,
    command: () => Promise<AtomCommandResult<A, E>>,
  ) => {
    const result = await runOne(key, failureTitle, command);
    refresh();
    return result;
  };
  const deployable =
    app !== null &&
    status !== null &&
    isDeployable({ firstStartedAt: app.firstStartedAt, running: phase === "running", status });
  // No button until there is something to deploy.
  const action = status === null || !deployable ? null : deployActionOf(status);
  const act = async () => {
    if (app === null || action === null || action.kind === "busy") return;
    if (action.kind === "open") {
      await openPage(environmentId, app.projectId, "deploy");
      return;
    }
    await run("deploy", `Could not deploy ${app.name}`, () =>
      redeploy({ environmentId, input: { projectId: app.projectId } }),
    );
  };

  return {
    status,
    /** Why production's status could not be read, while there is none to show instead. */
    error: status === null ? query.error : null,
    retry: refresh,
    action,
    deployable,
    working,
    busy,
    run,
    act,
  };
}

export type AppDeploy = ReturnType<typeof useAppDeploy>;
