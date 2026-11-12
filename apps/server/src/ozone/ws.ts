import {
  OZONE_WS_METHODS,
  type OzoneAppConfigureInput,
  type OzoneAppCreateInput,
  type OzoneAppDeleteInput,
  type OzoneAppRestoreInput,
  type OzoneBuild,
  type OzoneBuildApproveInput,
  type OzoneDataRestoreInput,
  type OzoneDataSnapshotInput,
  type OzoneDeployLogsInput,
  type OzoneDeployOutputInput,
  type OzoneDeployRollbackInput,
  type OzoneDeployRunInput,
  type OzoneDeployWebhookInput,
  type OzoneNotifyChannel,
  type OzoneServerInput,
  type OzoneServerSetupInput,
  type OzoneEnvRemoveInput,
  type OzoneEnvSetInput,
  type OzoneHistoryRestoreInput,
  type OzoneRuntimeActInput,
  type OzoneRuntimeLogsInput,
  type OzoneRuntimeSubscribeInput,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as OzoneApps from "./apps/OzoneApps.ts";
import * as BuildModel from "./builds/BuildModel.ts";
import * as BuildReview from "./builds/BuildReview.ts";
import * as BuildStore from "./builds/BuildStore.ts";
import * as AppData from "./data/AppData.ts";
import * as AppDeploy from "./deploy/AppDeploy.ts";
import * as AppServers from "./deploy/AppServers.ts";
import * as Notifier from "./deploy/Notifier.ts";
import * as AppEnv from "./env/AppEnv.ts";
import * as AppHistory from "./history/AppHistory.ts";
import * as AppRuntime from "./runtime/AppRuntime.ts";

const make = Effect.gen(function* () {
  const apps = yield* OzoneApps.OzoneApps;
  const runtime = yield* AppRuntime.AppRuntime;
  const data = yield* AppData.AppData;
  const builds = yield* BuildStore.BuildStore;
  const review = yield* BuildReview.BuildReview;
  const history = yield* AppHistory.AppHistory;
  const env = yield* AppEnv.AppEnv;
  const deploys = yield* AppDeploy.AppDeploy;
  const servers = yield* AppServers.AppServers;
  const notifier = yield* Notifier.Notifier;
  const buildSnapshot = (build: OzoneBuild | null) => ({
    build,
    status: build === null ? ("planning" as const) : BuildModel.statusOf(build),
  });
  return {
    [OZONE_WS_METHODS.appsList]: () => apps.list,
    [OZONE_WS_METHODS.appsCreate]: (input: OzoneAppCreateInput) => apps.create(input),
    [OZONE_WS_METHODS.appsDelete]: (input: OzoneAppDeleteInput) => apps.remove(input),
    [OZONE_WS_METHODS.appsRestore]: (input: OzoneAppRestoreInput) => apps.restore(input),
    [OZONE_WS_METHODS.appsConfigure]: (input: OzoneAppConfigureInput) => apps.configure(input),
    [OZONE_WS_METHODS.runtimeAct]: (input: OzoneRuntimeActInput) => runtime.act(input),
    [OZONE_WS_METHODS.runtimeLogs]: (input: OzoneRuntimeLogsInput) => runtime.logs(input),
    [OZONE_WS_METHODS.runtimeSubscribe]: (input: OzoneRuntimeSubscribeInput) =>
      runtime.changes(input.projectId),
    [OZONE_WS_METHODS.dataList]: (input: {
      readonly projectId: ProjectId;
      readonly production?: boolean;
    }) =>
      Effect.map(
        input.production === true ? deploys.snapshots(input.projectId) : data.list(input.projectId),
        (snapshots) => ({ snapshots }),
      ),
    [OZONE_WS_METHODS.dataSnapshot]: (input: OzoneDataSnapshotInput) =>
      input.production === true
        ? deploys.snapshot(input)
        : data.snapshot({ ...input, reason: "manual" }),
    [OZONE_WS_METHODS.dataRestore]: (input: OzoneDataRestoreInput) =>
      input.production === true ? deploys.restore(input) : data.restore(input),
    [OZONE_WS_METHODS.buildSubscribe]: (input: { readonly threadId: ThreadId }) =>
      Stream.map(builds.changes(input.threadId), buildSnapshot),
    [OZONE_WS_METHODS.buildApprove]: (input: OzoneBuildApproveInput) =>
      Effect.map(review.approve(input.threadId), buildSnapshot),
    [OZONE_WS_METHODS.historyList]: (input: { readonly projectId: ProjectId }) =>
      history.list(input.projectId),
    [OZONE_WS_METHODS.historyRestore]: (input: OzoneHistoryRestoreInput) => history.restore(input),
    [OZONE_WS_METHODS.envList]: (input: { readonly projectId: ProjectId }) =>
      env.list(input.projectId),
    [OZONE_WS_METHODS.envSet]: (input: OzoneEnvSetInput) => env.set(input),
    [OZONE_WS_METHODS.envRemove]: (input: OzoneEnvRemoveInput) => env.remove(input),
    [OZONE_WS_METHODS.deployStatus]: (input: { readonly projectId: ProjectId }) =>
      deploys.status(input.projectId),
    [OZONE_WS_METHODS.deployRun]: (input: OzoneDeployRunInput) => deploys.deploy(input),
    [OZONE_WS_METHODS.deployStop]: (input: { readonly projectId: ProjectId }) =>
      deploys.stop(input.projectId),
    [OZONE_WS_METHODS.deployHistory]: (input: { readonly projectId: ProjectId }) =>
      deploys.history(input.projectId),
    [OZONE_WS_METHODS.deployOutput]: (input: OzoneDeployOutputInput) =>
      Effect.map(deploys.output(input.projectId, input.deploymentId), (text) => ({ text })),
    [OZONE_WS_METHODS.deployRollback]: (input: OzoneDeployRollbackInput) => deploys.rollback(input),
    [OZONE_WS_METHODS.deployLogs]: (input: OzoneDeployLogsInput) =>
      Effect.map(deploys.logs(input), (text) => ({ text })),
    [OZONE_WS_METHODS.deployMetrics]: (input: { readonly projectId: ProjectId }) =>
      deploys.metrics(input.projectId),
    [OZONE_WS_METHODS.deployWebhook]: (input: OzoneDeployWebhookInput) => deploys.webhook(input),
    [OZONE_WS_METHODS.serverCheck]: (input: OzoneServerInput) => servers.check(input.host),
    [OZONE_WS_METHODS.serverSetup]: (input: OzoneServerSetupInput) => servers.setup(input),
    [OZONE_WS_METHODS.notifyList]: () => notifier.list,
    [OZONE_WS_METHODS.notifySet]: (input: OzoneNotifyChannel) => notifier.set(input),
    [OZONE_WS_METHODS.notifyRemove]: (input: { readonly id: string }) => notifier.remove(input.id),
    [OZONE_WS_METHODS.notifyTest]: (input: { readonly id: string }) =>
      Effect.as(notifier.test(input.id), {}),
  };
});

const notProvided = Effect.die(
  new Error("Ozone's WebSocket handlers need Ozone.layer among the server's layers."),
);

/**
 * Upstream builds its WebSocket handlers in many tests of its own. Reading Ozone's handlers through
 * a reference with a default keeps those tests unchanged: only the real server provides the layer.
 */
export class OzoneWsHandlers extends Context.Reference<Effect.Success<typeof make>>(
  "t3/ozone/ws/OzoneWsHandlers",
  {
    defaultValue: () => ({
      [OZONE_WS_METHODS.appsList]: () => notProvided,
      [OZONE_WS_METHODS.appsCreate]: () => notProvided,
      [OZONE_WS_METHODS.appsDelete]: () => notProvided,
      [OZONE_WS_METHODS.appsRestore]: () => notProvided,
      [OZONE_WS_METHODS.appsConfigure]: () => notProvided,
      [OZONE_WS_METHODS.runtimeAct]: () => notProvided,
      [OZONE_WS_METHODS.runtimeLogs]: () => notProvided,
      [OZONE_WS_METHODS.runtimeSubscribe]: () => Stream.fromEffect(notProvided),
      [OZONE_WS_METHODS.dataList]: () => notProvided,
      [OZONE_WS_METHODS.dataSnapshot]: () => notProvided,
      [OZONE_WS_METHODS.dataRestore]: () => notProvided,
      [OZONE_WS_METHODS.buildSubscribe]: () => Stream.fromEffect(notProvided),
      [OZONE_WS_METHODS.buildApprove]: () => notProvided,
      [OZONE_WS_METHODS.historyList]: () => notProvided,
      [OZONE_WS_METHODS.historyRestore]: () => notProvided,
      [OZONE_WS_METHODS.envList]: () => notProvided,
      [OZONE_WS_METHODS.envSet]: () => notProvided,
      [OZONE_WS_METHODS.envRemove]: () => notProvided,
      [OZONE_WS_METHODS.deployStatus]: () => notProvided,
      [OZONE_WS_METHODS.deployRun]: () => notProvided,
      [OZONE_WS_METHODS.deployStop]: () => notProvided,
      [OZONE_WS_METHODS.deployHistory]: () => notProvided,
      [OZONE_WS_METHODS.deployOutput]: () => notProvided,
      [OZONE_WS_METHODS.deployRollback]: () => notProvided,
      [OZONE_WS_METHODS.deployLogs]: () => notProvided,
      [OZONE_WS_METHODS.deployMetrics]: () => notProvided,
      [OZONE_WS_METHODS.deployWebhook]: () => notProvided,
      [OZONE_WS_METHODS.serverCheck]: () => notProvided,
      [OZONE_WS_METHODS.serverSetup]: () => notProvided,
      [OZONE_WS_METHODS.notifyList]: () => notProvided,
      [OZONE_WS_METHODS.notifySet]: () => notProvided,
      [OZONE_WS_METHODS.notifyRemove]: () => notProvided,
      [OZONE_WS_METHODS.notifyTest]: () => notProvided,
    }),
  },
) {}

export const layer = Layer.effect(OzoneWsHandlers, make);
