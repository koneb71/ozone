import { OZONE_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createOzoneEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    apps: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:apps",
      tag: OZONE_WS_METHODS.appsList,
      staleTimeMs: 5_000,
    }),
    createApp: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:create-app",
      tag: OZONE_WS_METHODS.appsCreate,
    }),
    deleteApp: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:delete-app",
      tag: OZONE_WS_METHODS.appsDelete,
    }),
    restoreApp: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:restore-app",
      tag: OZONE_WS_METHODS.appsRestore,
    }),
    configureApp: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:configure-app",
      tag: OZONE_WS_METHODS.appsConfigure,
    }),
    runtimeStatus: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:ozone:runtime-status",
      tag: OZONE_WS_METHODS.runtimeSubscribe,
    }),
    runtimeAct: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:runtime-act",
      tag: OZONE_WS_METHODS.runtimeAct,
      // One action per app at a time: Stop must not overtake the Start before it.
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.projectId]),
      },
    }),
    runtimeLogs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:runtime-logs",
      tag: OZONE_WS_METHODS.runtimeLogs,
      staleTimeMs: 0,
    }),
    buildStatus: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:ozone:build-status",
      tag: OZONE_WS_METHODS.buildSubscribe,
    }),
    approveBuild: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:approve-build",
      tag: OZONE_WS_METHODS.buildApprove,
    }),
    snapshots: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:snapshots",
      tag: OZONE_WS_METHODS.dataList,
      staleTimeMs: 0,
    }),
    takeSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:take-snapshot",
      tag: OZONE_WS_METHODS.dataSnapshot,
    }),
    restoreSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:restore-snapshot",
      tag: OZONE_WS_METHODS.dataRestore,
    }),
    history: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:history",
      tag: OZONE_WS_METHODS.historyList,
      staleTimeMs: 0,
    }),
    restoreHistory: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:restore-history",
      tag: OZONE_WS_METHODS.historyRestore,
    }),
    env: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:env",
      tag: OZONE_WS_METHODS.envList,
      staleTimeMs: 0,
    }),
    setEnv: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:set-env",
      tag: OZONE_WS_METHODS.envSet,
    }),
    removeEnv: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:remove-env",
      tag: OZONE_WS_METHODS.envRemove,
    }),
    deployStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:deploy-status",
      tag: OZONE_WS_METHODS.deployStatus,
      staleTimeMs: 0,
    }),
    deploy: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:deploy",
      tag: OZONE_WS_METHODS.deployRun,
    }),
    stopDeploy: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:stop-deploy",
      tag: OZONE_WS_METHODS.deployStop,
    }),
  };
}
