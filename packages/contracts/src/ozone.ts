import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

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

export const OzoneApp = Schema.Struct({
  projectId: ProjectId,
  /** Also the Compose project name, so it never changes after creation. */
  slug: ShortText,
  name: ShortText,
  templateId: ShortText,
  port: Port,
  createdAt: IsoDateTime,
});
export type OzoneApp = typeof OzoneApp.Type;

export const OzoneDockerStatus = Schema.Struct({
  available: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  /** What to do when Docker is not available. */
  message: Schema.NullOr(Schema.String),
});
export type OzoneDockerStatus = typeof OzoneDockerStatus.Type;

export const OzoneAppsListResult = Schema.Struct({
  apps: Schema.Array(OzoneApp),
  templates: Schema.Array(OzoneTemplateSummary),
  docker: OzoneDockerStatus,
});
export type OzoneAppsListResult = typeof OzoneAppsListResult.Type;

export const OzoneAppCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  templateId: Schema.optionalKey(ShortText),
});
export type OzoneAppCreateInput = typeof OzoneAppCreateInput.Type;

export const OzoneAppCreateResult = Schema.Struct({
  app: OzoneApp,
  workspaceRoot: Schema.String,
});
export type OzoneAppCreateResult = typeof OzoneAppCreateResult.Type;

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
  updatedAt: IsoDateTime,
});
export type OzoneRuntimeStatus = typeof OzoneRuntimeStatus.Type;

export const OzoneRuntimeAction = Schema.Literals(["up", "stop", "restart", "rebuild"]);
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

export const OZONE_WS_METHODS = {
  appsList: "ozone.apps.list",
  appsCreate: "ozone.apps.create",
  runtimeAct: "ozone.runtime.act",
  runtimeLogs: "ozone.runtime.logs",
  runtimeSubscribe: "ozone.runtime.subscribe",
} as const;

type OzoneWsMethod = (typeof OZONE_WS_METHODS)[keyof typeof OZONE_WS_METHODS];

/** The methods that stream; the client keeps its own list of those. */
export type OzoneSubscriptionMethod = typeof OZONE_WS_METHODS.runtimeSubscribe;

/** Spread into the server's scope map, which must name every method. */
export const OZONE_RPC_SCOPES = {
  [OZONE_WS_METHODS.appsList]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.appsCreate]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.runtimeAct]: AuthOrchestrationOperateScope,
  [OZONE_WS_METHODS.runtimeLogs]: AuthOrchestrationReadScope,
  [OZONE_WS_METHODS.runtimeSubscribe]: AuthOrchestrationReadScope,
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
] as const;
