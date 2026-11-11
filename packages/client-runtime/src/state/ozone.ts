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
  };
}
