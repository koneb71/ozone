import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  OzoneBuildApproveInput,
  OzoneBuildSnapshot,
  OzoneBuildSubscribeInput,
} from "./ozoneBuild.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  OzoneDeployHistoryResult,
  OzoneDeployLogsInput,
  OzoneDeployMetrics,
  OzoneDeployOutputInput,
  OzoneDeployOutputResult,
  OzoneDeployRollbackInput,
  OzoneDeployRunInput,
  OzoneRedeployInput,
  OzoneDeployStatus,
  OzoneDeployStatusInput,
  OzoneDeployWebhookInput,
  OzoneDeployWebhookResult,
  OzoneNotifyChannel,
  OzoneNotifyListResult,
  OzoneNotifyRemoveInput,
  OzoneServerAddInput,
  OzoneServerInput,
  OzoneServerKeyResult,
  OzoneServerRemoveInput,
  OzoneServerRemoveResult,
  OzoneServerReport,
  OzoneServerSetupInput,
  OzoneServersListResult,
} from "./ozoneDeploy.ts";

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const CommandText = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));
const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }));

/** The file at an app's root that tells Ozone how to run, check and protect it. */
export const OZONE_MANIFEST_FILE_NAME = "ozone.json";

export const OzoneGate = Schema.Struct({
  id: ShortText,
  command: CommandText,
  /** `task` gates run after every task; `final` gates run once before a build completes. */
  when: Schema.Literals(["task", "final"]),
});
export type OzoneGate = typeof OzoneGate.Type;

export const OzoneDataService = Schema.Struct({
  service: ShortText,
  kind: Schema.Literals(["postgres", "volume"]),
  volume: ShortText,
  database: Schema.optionalKey(ShortText),
  user: Schema.optionalKey(ShortText),
});
export type OzoneDataService = typeof OzoneDataService.Type;

export const OzoneAppManifest = Schema.Struct({
  version: Schema.Literal(1),
  template: Schema.optionalKey(ShortText),
  runtime: Schema.Struct({
    kind: Schema.Literal("compose"),
    file: ShortText,
    appService: ShortText,
    appPort: Port,
    healthPath: ShortText,
  }),
  gates: Schema.Array(OzoneGate).check(Schema.isMaxLength(16)),
  data: Schema.Struct({
    services: Schema.Array(OzoneDataService).check(Schema.isMaxLength(16)),
  }),
  migrations: Schema.optionalKey(
    Schema.Struct({ directory: ShortText, generate: CommandText, apply: CommandText }),
  ),
});
export type OzoneAppManifest = typeof OzoneAppManifest.Type;

export const OzoneTemplateSummary = Schema.Struct({
  id: ShortText,
  name: ShortText,
  description: Schema.String,
  stack: Schema.Array(ShortText),
});
export type OzoneTemplateSummary = typeof OzoneTemplateSummary.Type;

/** The model an app's workers and verifier run on. The lead keeps the model of its own thread. */
export const OzoneWorkerModel = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  model: ShortText,
});
export type OzoneWorkerModel = typeof OzoneWorkerModel.Type;

/** How one app's builds run. Every field has a default, so an older record still reads. */
export const OzoneAppSettings = Schema.Struct({
  /** The lead's plan waits for the person's approval before any work starts. */
  reviewPlans: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** A finished build is tried in the browser against its acceptance criteria. */
  verifyBuilds: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  /** Null: workers use the lead's model. */
  workerModel: Schema.NullOr(OzoneWorkerModel).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  /** A build that completes is deployed where the app was last deployed. */
  deployOnBuild: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});
export type OzoneAppSettings = typeof OzoneAppSettings.Type;

export const DEFAULT_OZONE_APP_SETTINGS: OzoneAppSettings = {
  reviewPlans: false,
  verifyBuilds: true,
  workerModel: null,
  deployOnBuild: false,
};

export const OzoneApp = Schema.Struct({
  projectId: ProjectId,
  /** Also the Compose project name, so it never changes after creation. */
  slug: ShortText,
  name: ShortText,
  templateId: ShortText,
  port: Port,
  createdAt: IsoDateTime,
  settings: OzoneAppSettings.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_OZONE_APP_SETTINGS)),
  ),
  /** When the app first came up healthy. Until then there is nothing to deploy. */
  firstStartedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
});
export type OzoneApp = typeof OzoneApp.Type;

/** Where a running app answers on the machine that runs its containers. */
export const ozoneAppUrl = (app: Pick<OzoneApp, "port">): string => `http://localhost:${app.port}`;

export const OzoneDockerStatus = Schema.Struct({
  available: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  /** What to do when Docker is not available. */
  message: Schema.NullOr(Schema.String),
  /** Why it is not available, so a client can offer the right help. */
  problem: Schema.NullOr(Schema.Literals(["missing", "stopped", "denied", "no-compose"])).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
});
export type OzoneDockerStatus = typeof OzoneDockerStatus.Type;

/** A deleted app whose folder and snapshots are still there, so it can be brought back. */
export const OzoneDeletedApp = Schema.Struct({
  slug: ShortText,
  name: Schema.String,
  templateId: ShortText,
  workspaceRoot: Schema.String,
  /** Null for an app deleted before Ozone recorded the time. */
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OzoneDeletedApp = typeof OzoneDeletedApp.Type;

export const OzoneAppsListResult = Schema.Struct({
  apps: Schema.Array(OzoneApp),
  templates: Schema.Array(OzoneTemplateSummary),
  docker: OzoneDockerStatus,
  deleted: Schema.Array(OzoneDeletedApp).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** Ozone's own folder for apps, used until the user chooses another. */
  defaultDirectory: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
});
export type OzoneAppsListResult = typeof OzoneAppsListResult.Type;

const OzoneAppSettingsPatch = Schema.Struct({
  reviewPlans: Schema.optionalKey(Schema.Boolean),
  verifyBuilds: Schema.optionalKey(Schema.Boolean),
  workerModel: Schema.optionalKey(Schema.NullOr(OzoneWorkerModel)),
  deployOnBuild: Schema.optionalKey(Schema.Boolean),
});

export const OzoneAppCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  templateId: Schema.optionalKey(ShortText),
  settings: Schema.optionalKey(OzoneAppSettingsPatch),
});
export type OzoneAppCreateInput = typeof OzoneAppCreateInput.Type;

export const OzoneAppConfigureInput = Schema.Struct({
  projectId: ProjectId,
  settings: OzoneAppSettingsPatch,
});
export type OzoneAppConfigureInput = typeof OzoneAppConfigureInput.Type;

export const OzoneAppCreateResult = Schema.Struct({
  app: OzoneApp,
  workspaceRoot: Schema.String,
});
export type OzoneAppCreateResult = typeof OzoneAppCreateResult.Type;

export const OzoneAppDeleteInput = Schema.Struct({ projectId: ProjectId });
export type OzoneAppDeleteInput = typeof OzoneAppDeleteInput.Type;

export const OzoneAppRestoreInput = Schema.Struct({ slug: ShortText });
export type OzoneAppRestoreInput = typeof OzoneAppRestoreInput.Type;

/** The newest published Ozone beside the one this server runs. */
export const OzoneVersionCheck = Schema.Struct({
  current: Schema.String,
  latest: Schema.String,
  newer: Schema.Boolean,
});
export type OzoneVersionCheck = typeof OzoneVersionCheck.Type;

export class OzoneAppError extends Schema.TaggedError<OzoneAppError>()("OzoneAppError", {
  /** Clients branch on the named reasons and show the message for `failed`. */
  reason: Schema.Literals([
    "unknown_template",
    "not_an_app",
    "invalid_manifest",
    "docker_unavailable",
    "failed",
  ]),
  message: Schema.String,
}) {}

export const OzoneRuntimePhase = Schema.Literals([
  "unavailable",
  "stopped",
  "starting",
  "running",
  "unhealthy",
  "failed",
]);
export type OzoneRuntimePhase = typeof OzoneRuntimePhase.Type;

export const OzoneRuntimeService = Schema.Struct({
  service: ShortText,
  /** Docker's container state, such as `running` or `exited`. */
  state: Schema.String,
  health: Schema.NullOr(Schema.Literals(["starting", "healthy", "unhealthy"])),
  data: Schema.Boolean,
});
export type OzoneRuntimeService = typeof OzoneRuntimeService.Type;

export const OzoneRuntimeStatus = Schema.Struct({
  projectId: ProjectId,
  phase: OzoneRuntimePhase,
  /** Where the app answers on the environment's machine, once it is healthy. */
  url: Schema.NullOr(Schema.String),
  services: Schema.Array(OzoneRuntimeService),
  message: Schema.NullOr(Schema.String),
  /**
   * The statements of migrations the app's own migrate command held back because they can lose
   * data, one per line. They run only when a person accepts them with the `migrate` action.
   */
  migration: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  updatedAt: IsoDateTime,
});
export type OzoneRuntimeStatus = typeof OzoneRuntimeStatus.Type;

/** `migrate` runs held-back migrations after a snapshot. Only people can ask for it. */
export const OzoneRuntimeAction = Schema.Literals(["up", "stop", "restart", "rebuild", "migrate"]);
export type OzoneRuntimeAction = typeof OzoneRuntimeAction.Type;

export const OzoneRuntimeActInput = Schema.Struct({
  projectId: ProjectId,
  action: OzoneRuntimeAction,
});
export type OzoneRuntimeActInput = typeof OzoneRuntimeActInput.Type;

export const OzoneRuntimeLogsInput = Schema.Struct({
  projectId: ProjectId,
  service: Schema.optionalKey(ShortText),
  tail: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_000 }))),
});
export type OzoneRuntimeLogsInput = typeof OzoneRuntimeLogsInput.Type;

export const OzoneRuntimeLogsResult = Schema.Struct({ text: Schema.String });
export type OzoneRuntimeLogsResult = typeof OzoneRuntimeLogsResult.Type;

export const OzoneRuntimeSubscribeInput = Schema.Struct({ projectId: ProjectId });
export type OzoneRuntimeSubscribeInput = typeof OzoneRuntimeSubscribeInput.Type;

export const OzoneSnapshotReason = Schema.Literals([
  "manual",
  "task",
  "before-rebuild",
  "before-restore",
  "before-delete",
  "before-migrate",
  "before-deploy",
]);
export type OzoneSnapshotReason = typeof OzoneSnapshotReason.Type;

/** A restorable copy of an app's data, kept outside its workspace. */
export const OzoneSnapshot = Schema.Struct({
  id: ShortText,
  projectId: ProjectId,
  createdAt: IsoDateTime,
  reason: OzoneSnapshotReason,
  label: Schema.NullOr(Schema.String),
  /** The commit the app's code was at, so a code rollback and a data restore can line up. */
  commitSha: Schema.NullOr(Schema.String),
  sizeBytes: Schema.Number,
});
export type OzoneSnapshot = typeof OzoneSnapshot.Type;

/** What is left after an app is deleted: its last snapshot and its folder. */
export const OzoneAppDeleteResult = Schema.Struct({
  snapshot: OzoneSnapshot,
  workspaceRoot: Schema.String,
});
export type OzoneAppDeleteResult = typeof OzoneAppDeleteResult.Type;

/** Set on the data methods to mean the deployed app's data, which is kept apart. */
const Production = Schema.optionalKey(Schema.Boolean);

export const OzoneDataListInput = Schema.Struct({ projectId: ProjectId, production: Production });
export const OzoneDataListResult = Schema.Struct({ snapshots: Schema.Array(OzoneSnapshot) });
export type OzoneDataListResult = typeof OzoneDataListResult.Type;

export const OzoneDataSnapshotInput = Schema.Struct({
  projectId: ProjectId,
  label: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  production: Production,
});
export type OzoneDataSnapshotInput = typeof OzoneDataSnapshotInput.Type;

export const OzoneDataRestoreInput = Schema.Struct({
  projectId: ProjectId,
  snapshotId: ShortText,
  production: Production,
});
export type OzoneDataRestoreInput = typeof OzoneDataRestoreInput.Type;

export const OzoneDataRestoreResult = Schema.Struct({
  /** Taken from the data as it was just before the restore, so the restore can be undone. */
  safety: OzoneSnapshot,
});
export type OzoneDataRestoreResult = typeof OzoneDataRestoreResult.Type;

/** One commit of an app: a passed build task, a restore, or the template it started from. */
export const OzoneHistoryEntry = Schema.Struct({
  sha: Schema.String,
  subject: Schema.String,
  committedAt: Schema.String,
  /** The newest snapshot taken at this commit: restoring here brings that data back too. */
  snapshot: Schema.NullOr(OzoneSnapshot),
});
export type OzoneHistoryEntry = typeof OzoneHistoryEntry.Type;

export const OzoneHistoryListInput = Schema.Struct({ projectId: ProjectId });
export const OzoneHistoryListResult = Schema.Struct({
  /** Newest first. The first is where the app is now. */
  entries: Schema.Array(OzoneHistoryEntry),
});
export type OzoneHistoryListResult = typeof OzoneHistoryListResult.Type;

export const OzoneHistoryRestoreInput = Schema.Struct({
  projectId: ProjectId,
  sha: TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{40,64}$/)),
});
export type OzoneHistoryRestoreInput = typeof OzoneHistoryRestoreInput.Type;

export const OzoneHistoryRestoreResult = Schema.Struct({
  /** The new commit that holds the restored code. */
  commitSha: Schema.String,
  /** Taken from the data as it was just before, when data was restored too. */
  safety: Schema.NullOr(OzoneSnapshot),
});
export type OzoneHistoryRestoreResult = typeof OzoneHistoryRestoreResult.Type;

const EnvName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
).annotate({ description: "A variable name such as `STRIPE_API_KEY`." });

/** A variable as it is stored, value included. It never leaves the server for a secret. */
export const OzoneEnvVariableValue = Schema.Struct({
  name: EnvName,
  value: Schema.String.check(Schema.isMaxLength(32_768)),
  /** A secret is written once and never read back by a client or an agent. */
  secret: Schema.Boolean,
});
export type OzoneEnvVariableValue = typeof OzoneEnvVariableValue.Type;

/** A variable as clients see it: a secret's value is null. */
export const OzoneEnvVariable = Schema.Struct({
  name: Schema.String,
  secret: Schema.Boolean,
  value: Schema.NullOr(Schema.String),
});
export type OzoneEnvVariable = typeof OzoneEnvVariable.Type;

export const OzoneEnvListInput = Schema.Struct({ projectId: ProjectId });
export const OzoneEnvListResult = Schema.Struct({ variables: Schema.Array(OzoneEnvVariable) });
export type OzoneEnvListResult = typeof OzoneEnvListResult.Type;

export const OzoneEnvSetInput = Schema.Struct({
  projectId: ProjectId,
  ...OzoneEnvVariableValue.fields,
});
export type OzoneEnvSetInput = typeof OzoneEnvSetInput.Type;

export const OzoneEnvRemoveInput = Schema.Struct({ projectId: ProjectId, name: EnvName });
export type OzoneEnvRemoveInput = typeof OzoneEnvRemoveInput.Type;

export const OZONE_WS_METHODS = {
  appsList: "ozone.apps.list",
  appsCreate: "ozone.apps.create",
  appsDelete: "ozone.apps.delete",
  appsRestore: "ozone.apps.restore",
  appsConfigure: "ozone.apps.configure",
  runtimeAct: "ozone.runtime.act",
  runtimeLogs: "ozone.runtime.logs",
  runtimeSubscribe: "ozone.runtime.subscribe",
  dataList: "ozone.data.list",
  dataSnapshot: "ozone.data.snapshot",
  dataRestore: "ozone.data.restore",
  buildSubscribe: "ozone.build.subscribe",
  buildApprove: "ozone.build.approve",
  historyList: "ozone.history.list",
  historyRestore: "ozone.history.restore",
  envList: "ozone.env.list",
  envSet: "ozone.env.set",
  envRemove: "ozone.env.remove",
  deployStatus: "ozone.deploy.status",
  deployRun: "ozone.deploy.run",
  deployRedeploy: "ozone.deploy.redeploy",
  deployStop: "ozone.deploy.stop",
  deployHistory: "ozone.deploy.history",
  deployOutput: "ozone.deploy.output",
  deployRollback: "ozone.deploy.rollback",
  deployLogs: "ozone.deploy.logs",
  deployMetrics: "ozone.deploy.metrics",
  deployWebhook: "ozone.deploy.webhook",
  serverCheck: "ozone.server.check",
  serverSetup: "ozone.server.setup",
  serversList: "ozone.servers.list",
  serversAdd: "ozone.servers.add",
  serversRemove: "ozone.servers.remove",
  serversKey: "ozone.servers.key",
  notifyList: "ozone.notify.list",
  notifySet: "ozone.notify.set",
  notifyRemove: "ozone.notify.remove",
  notifyTest: "ozone.notify.test",
  versionCheck: "ozone.version.check",
} as const;

type OzoneWsMethod = (typeof OZONE_WS_METHODS)[keyof typeof OZONE_WS_METHODS];

/** The methods that stream; the client keeps its own list of those. */
export type OzoneSubscriptionMethod =
  | typeof OZONE_WS_METHODS.runtimeSubscribe
  | typeof OZONE_WS_METHODS.buildSubscribe;

/** The methods that change something. A client offers one only with its scope. */
export const OZONE_OPERATE_RPC_SCOPES = {
  [OZONE_WS_METHODS.appsCreate]: AuthOrchestrationOperateScope,
  // Removes the app's containers and data, behind a snapshot.
  [OZONE_WS_METHODS.appsDelete]: AuthOrchestrationOperateScope,
  // Brings a deleted app back from its folder and its last snapshot.
  [OZONE_WS_METHODS.appsRestore]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.appsConfigure]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.runtimeAct]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.dataSnapshot]: AuthOrchestrationOperateScope,
  // Replaces the app's data: only a client that can already change the project may.
  [OZONE_WS_METHODS.dataRestore]: AuthOrchestrationOperateScope,
  // Starts the work of a plan: the same right as sending the lead a message.
  [OZONE_WS_METHODS.buildApprove]: AuthOrchestrationOperateScope,
  // Replaces the app's code and data, behind a commit and a snapshot of both as they are.
  [OZONE_WS_METHODS.historyRestore]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.envSet]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.envRemove]: AuthOrchestrationOperateScope,
  // Runs the app where others can reach it, with this machine's Docker or SSH access.
  [OZONE_WS_METHODS.deployRun]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.deployRedeploy]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.deployStop]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.deployRollback]: AuthOrchestrationOperateScope,
  // The URL it shows is a credential: anyone with it can deploy the app.
  [OZONE_WS_METHODS.deployWebhook]: AuthOrchestrationOperateScope,
  // Both reach a server with this machine's SSH keys; setup can install Docker there.
  [OZONE_WS_METHODS.serverCheck]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.serverSetup]: AuthOrchestrationOperateScope,
  // Signs in to a server, and keeps a way back in: a key, or a Dokploy API key.
  [OZONE_WS_METHODS.serversAdd]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.serversRemove]: AuthOrchestrationOperateScope,
  // Makes Ozone's SSH key the first time; what it shows is public.
  [OZONE_WS_METHODS.serversKey]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.notifySet]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.notifyRemove]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.notifyTest]: AuthOrchestrationOperateScope,
  // It reaches out to GitHub from the server, so a read-only session cannot start it.
  [OZONE_WS_METHODS.versionCheck]: AuthOrchestrationOperateScope,
} as const;

/** Spread into the server's scope map, which must name every method. */
export const OZONE_RPC_SCOPES = {
  ...OZONE_OPERATE_RPC_SCOPES,
  [OZONE_WS_METHODS.appsList]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.runtimeLogs]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.runtimeSubscribe]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.dataList]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.buildSubscribe]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.historyList]: AuthOrchestrationReadScope,
  // Secrets' values are never in the list.
  [OZONE_WS_METHODS.envList]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.deployStatus]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.deployHistory]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.deployOutput]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.deployLogs]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.deployMetrics]: AuthOrchestrationReadScope,
  // Channels' secrets are never in the list.
  [OZONE_WS_METHODS.notifyList]: AuthOrchestrationReadScope,
  // API keys are never in the list.
  [OZONE_WS_METHODS.serversList]: AuthOrchestrationReadScope,
} as const;

/** Every Ozone method reports under one aggregate in traces. */
export const OZONE_RPC_AGGREGATES = Object.fromEntries(
  Object.values(OZONE_WS_METHODS).map((method) => [method, "ozone"]),
) as Readonly<Record<OzoneWsMethod, "ozone">>;

const OzoneRpcError = Schema.Union([OzoneAppError, EnvironmentAuthorizationError]);

/** Spread into `WsRpcGroup`; the handlers live in `apps/server/src/ozone/ws.ts`. */
export const OzoneWsRpcs = [
  Rpc.make(OZONE_WS_METHODS.appsList, {
    payload: Schema.Struct({}),
    success: OzoneAppsListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.appsCreate, {
    payload: OzoneAppCreateInput,
    success: OzoneAppCreateResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.appsDelete, {
    payload: OzoneAppDeleteInput,
    success: OzoneAppDeleteResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.appsRestore, {
    payload: OzoneAppRestoreInput,
    success: OzoneAppCreateResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.runtimeAct, {
    payload: OzoneRuntimeActInput,
    success: OzoneRuntimeStatus,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.runtimeLogs, {
    payload: OzoneRuntimeLogsInput,
    success: OzoneRuntimeLogsResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.runtimeSubscribe, {
    payload: OzoneRuntimeSubscribeInput,
    success: OzoneRuntimeStatus,
    error: OzoneRpcError,
    stream: true,
  }),
  Rpc.make(OZONE_WS_METHODS.dataList, {
    payload: OzoneDataListInput,
    success: OzoneDataListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.dataSnapshot, {
    payload: OzoneDataSnapshotInput,
    success: OzoneSnapshot,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.dataRestore, {
    payload: OzoneDataRestoreInput,
    success: OzoneDataRestoreResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.buildSubscribe, {
    payload: OzoneBuildSubscribeInput,
    success: OzoneBuildSnapshot,
    error: OzoneRpcError,
    stream: true,
  }),
  Rpc.make(OZONE_WS_METHODS.appsConfigure, {
    payload: OzoneAppConfigureInput,
    success: OzoneApp,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.buildApprove, {
    payload: OzoneBuildApproveInput,
    success: OzoneBuildSnapshot,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.historyList, {
    payload: OzoneHistoryListInput,
    success: OzoneHistoryListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.historyRestore, {
    payload: OzoneHistoryRestoreInput,
    success: OzoneHistoryRestoreResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.envList, {
    payload: OzoneEnvListInput,
    success: OzoneEnvListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.envSet, {
    payload: OzoneEnvSetInput,
    success: OzoneEnvListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.envRemove, {
    payload: OzoneEnvRemoveInput,
    success: OzoneEnvListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployStatus, {
    payload: OzoneDeployStatusInput,
    success: OzoneDeployStatus,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployRun, {
    payload: OzoneDeployRunInput,
    success: OzoneDeployStatus,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployRedeploy, {
    payload: OzoneRedeployInput,
    success: OzoneDeployStatus,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployStop, {
    payload: OzoneDeployStatusInput,
    success: OzoneDeployStatus,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployHistory, {
    payload: OzoneDeployStatusInput,
    success: OzoneDeployHistoryResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployOutput, {
    payload: OzoneDeployOutputInput,
    success: OzoneDeployOutputResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployRollback, {
    payload: OzoneDeployRollbackInput,
    success: OzoneDeployStatus,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployLogs, {
    payload: OzoneDeployLogsInput,
    success: OzoneRuntimeLogsResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployMetrics, {
    payload: OzoneDeployStatusInput,
    success: OzoneDeployMetrics,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.deployWebhook, {
    payload: OzoneDeployWebhookInput,
    success: OzoneDeployWebhookResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.serverCheck, {
    payload: OzoneServerInput,
    success: OzoneServerReport,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.serverSetup, {
    payload: OzoneServerSetupInput,
    success: OzoneServerReport,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.serversList, {
    payload: Schema.Struct({}),
    success: OzoneServersListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.serversAdd, {
    payload: OzoneServerAddInput,
    success: OzoneServersListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.serversRemove, {
    payload: OzoneServerRemoveInput,
    success: OzoneServerRemoveResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.serversKey, {
    payload: Schema.Struct({}),
    success: OzoneServerKeyResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.notifyList, {
    payload: Schema.Struct({}),
    success: OzoneNotifyListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.notifySet, {
    payload: OzoneNotifyChannel,
    success: OzoneNotifyListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.notifyRemove, {
    payload: OzoneNotifyRemoveInput,
    success: OzoneNotifyListResult,
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.notifyTest, {
    payload: OzoneNotifyRemoveInput,
    success: Schema.Struct({}),
    error: OzoneRpcError,
  }),
  Rpc.make(OZONE_WS_METHODS.versionCheck, {
    payload: Schema.Struct({}),
    success: OzoneVersionCheck,
    error: OzoneRpcError,
  }),
] as const;

export * from "./ozoneBuild.ts";
export * from "./ozoneDeploy.ts";
