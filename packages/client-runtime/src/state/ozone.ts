import {
  OZONE_WS_METHODS,
  type OzoneApp,
  type OzoneBuild,
  type OzoneBuildSnapshot,
  type OzoneBuildTask,
  type OzoneCriterionResult,
  type OzoneRuntimePhase,
  type OzoneRuntimeStatus,
} from "@t3tools/contracts";
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
    redeploy: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:redeploy",
      tag: OZONE_WS_METHODS.deployRedeploy,
    }),
    stopDeploy: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:stop-deploy",
      tag: OZONE_WS_METHODS.deployStop,
    }),
    deployHistory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:deploy-history",
      tag: OZONE_WS_METHODS.deployHistory,
      staleTimeMs: 0,
    }),
    deployOutput: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:deploy-output",
      tag: OZONE_WS_METHODS.deployOutput,
      staleTimeMs: 0,
    }),
    rollback: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:rollback",
      tag: OZONE_WS_METHODS.deployRollback,
    }),
    deployLogs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:deploy-logs",
      tag: OZONE_WS_METHODS.deployLogs,
      staleTimeMs: 0,
    }),
    deployMetrics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:deploy-metrics",
      tag: OZONE_WS_METHODS.deployMetrics,
      staleTimeMs: 0,
    }),
    deployWebhook: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:deploy-webhook",
      tag: OZONE_WS_METHODS.deployWebhook,
    }),
    checkVersion: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:check-version",
      tag: OZONE_WS_METHODS.versionCheck,
    }),
    checkServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:check-server",
      tag: OZONE_WS_METHODS.serverCheck,
    }),
    setupServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:setup-server",
      tag: OZONE_WS_METHODS.serverSetup,
    }),
    savedServers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:saved-servers",
      tag: OZONE_WS_METHODS.serversList,
      staleTimeMs: 0,
    }),
    addServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:add-server",
      tag: OZONE_WS_METHODS.serversAdd,
    }),
    removeServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:remove-server",
      tag: OZONE_WS_METHODS.serversRemove,
    }),
    serverKey: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:server-key",
      tag: OZONE_WS_METHODS.serversKey,
    }),
    serverEnv: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:server-env",
      tag: OZONE_WS_METHODS.serversEnvList,
      staleTimeMs: 0,
    }),
    setServerEnv: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:set-server-env",
      tag: OZONE_WS_METHODS.serversEnvSet,
    }),
    removeServerEnv: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:remove-server-env",
      tag: OZONE_WS_METHODS.serversEnvRemove,
    }),
    notifyChannels: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ozone:notify-channels",
      tag: OZONE_WS_METHODS.notifyList,
      staleTimeMs: 0,
    }),
    setNotifyChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:set-notify-channel",
      tag: OZONE_WS_METHODS.notifySet,
    }),
    removeNotifyChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:remove-notify-channel",
      tag: OZONE_WS_METHODS.notifyRemove,
    }),
    testNotifyChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ozone:test-notify-channel",
      tag: OZONE_WS_METHODS.notifyTest,
    }),
  };
}

export interface BuildHeadline {
  readonly tone: "info" | "success" | "warning";
  readonly title: string;
  readonly detail: string | undefined;
  readonly busy: boolean;
}

const settled = (task: OzoneBuildTask) => task.status === "done" || task.status === "skipped";

/** What a task is doing, in the words the build card shows beside its title. */
export function taskStateLabel(task: OzoneBuildTask, build: OzoneBuild): string {
  switch (task.status) {
    case "pending":
      return task.attempts > 0 ? "Going back for repair" : "Waiting";
    case "running":
      return task.attempts > 1 ? `Repairing (${task.attempts}/${build.maxAttempts})` : "Working";
    case "checking":
      return "Checking";
    case "blocked":
      return "Needs a decision";
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
  }
}

export const CRITERION_LABEL: Record<OzoneCriterionResult["verdict"], string> = {
  pass: "Works",
  fail: "Does not work",
  unchecked: "Not tried",
};

const failedCriteria = (build: OzoneBuild) =>
  build.verification.results.filter((result) => result.verdict === "fail");

/** The one line that says where a build stands. Null when there is nothing to show yet. */
export function buildHeadline(snapshot: OzoneBuildSnapshot | null): BuildHeadline | null {
  const build = snapshot?.build ?? null;
  if (snapshot === null || build === null || build.tasks.length === 0) return null;
  const done = build.tasks.filter(settled).length;
  const progress = `${done} of ${build.tasks.length} tasks done`;
  const tasks = `${build.tasks.length} ${build.tasks.length === 1 ? "task" : "tasks"}`;
  if (snapshot.status === "review") {
    return {
      tone: "info",
      title: "The plan is ready for you",
      detail: `${tasks}. Start it here, or ask for changes below.`,
      busy: false,
    };
  }
  if (snapshot.status === "complete") {
    const tried =
      build.verification.status === "passed"
        ? " · Tried in a browser"
        : build.verification.status === "accepted"
          ? " · Kept despite the browser test"
          : "";
    return { tone: "success", title: "Build complete", detail: `${progress}${tried}`, busy: false };
  }
  const blocked = build.tasks.find((task) => task.status === "blocked");
  if (blocked !== undefined) {
    return {
      tone: "warning",
      title: "The build needs a decision",
      detail: `${blocked.title}: ${blocked.blockedReason ?? "it could not be finished."}`,
      busy: false,
    };
  }
  if (snapshot.status === "blocked") {
    const failedGates = build.finalEvidence.filter((gate) => !gate.ok);
    if (failedGates.length > 0) {
      return {
        tone: "warning",
        title: "The final check failed",
        detail: failedGates.map((gate) => gate.id).join(", "),
        busy: false,
      };
    }
    const failed = failedCriteria(build);
    return {
      tone: "warning",
      title: "The app does not do everything asked",
      detail: `A browser test found ${failed.length === 1 ? "1 problem" : `${failed.length} problems`}. The lead is on it.`,
      busy: false,
    };
  }
  const active = build.tasks.find(
    (task) => task.status === "running" || task.status === "checking",
  );
  if (active !== undefined) {
    return {
      tone: "info",
      title: `Building · ${progress}`,
      detail: `${taskStateLabel(active, build)}: ${active.title}`,
      busy: true,
    };
  }
  if (build.finalStartedAt !== null) {
    return { tone: "info", title: "Running the final check", detail: progress, busy: true };
  }
  const testing = build.verification.status;
  if (testing === "running" || testing === "pending") {
    return {
      tone: "info",
      title: "Trying the app in a browser",
      detail: "A tester uses it the way you would.",
      busy: true,
    };
  }
  return { tone: "info", title: `Building · ${progress}`, detail: undefined, busy: false };
}

/** The app's runtime state in a word or two, as Home and the app's page show it. */
export function runtimePhaseLabel(phase: OzoneRuntimePhase | undefined): string {
  switch (phase) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "unhealthy":
      return "Unhealthy";
    case "failed":
      return "Failed";
    case "unavailable":
      return "Docker needed";
    case "stopped":
      return "Stopped";
    case undefined:
      return "Checking";
  }
}

export interface AppNotice {
  readonly tone: "default" | "info" | "warning" | "error";
  readonly title: string;
  readonly description: string | undefined;
}

/** What a thread says about the app it belongs to, above the composer. */
export function appNotice(app: OzoneApp, status: OzoneRuntimeStatus | null): AppNotice {
  const where = `localhost:${app.port}`;
  switch (status?.phase) {
    case undefined:
      return { tone: "default", title: app.name, description: where };
    case "running":
      return { tone: "default", title: `${app.name} is running`, description: where };
    case "starting":
      return {
        tone: "info",
        title: `Starting ${app.name}`,
        description: status.message ?? undefined,
      };
    case "stopped":
      return { tone: "default", title: `${app.name} is stopped`, description: where };
    case "unhealthy":
      return {
        tone: "warning",
        title: `${app.name} is not answering`,
        description: status.message ?? undefined,
      };
    case "failed":
      return {
        tone: "error",
        title: `${app.name} did not start`,
        description: status.message ?? undefined,
      };
    case "unavailable":
      return {
        tone: "warning",
        title: "Docker is not running",
        description: status.message ?? undefined,
      };
  }
}

/** Each project's most recently updated thread in one environment: the one opening an app shows. */
export function latestThreadByProject<
  Thread extends {
    readonly environmentId: string;
    readonly projectId: string;
    readonly updatedAt: string;
  },
>(threads: Iterable<Thread>, environmentId: string): ReadonlyMap<string, Thread> {
  const latest = new Map<string, Thread>();
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    const current = latest.get(thread.projectId);
    if (current === undefined || thread.updatedAt > current.updatedAt) {
      latest.set(thread.projectId, thread);
    }
  }
  return latest;
}
