import { OrchestratorMcpFailure, type OzoneAppError, ozoneAppUrl } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as OzoneApps from "../apps/OzoneApps.ts";
import * as BuildConductor from "../builds/BuildConductor.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { OzoneToolkit } from "./tools.ts";

/**
 * How long one step waits for a worker. Claude Code moves a tool call to the background after two
 * minutes, and the checks that follow a worker run in the same call. Other harnesses give up on a
 * call within a minute.
 */
const PATIENT_DRIVERS = new Set(["claudeAgent", "codex"]);
const LONG_PATIENCE = Duration.seconds(75);
const SHORT_PATIENCE = Duration.seconds(40);

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const fromApp = (error: OzoneAppError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "not_an_app" ? "invalid_request" : "orchestration_error",
    message:
      error.reason === "not_an_app"
        ? "This thread's project is not an Ozone app, so it has no build and no containers."
        : error.message,
  });

/** The calling thread and the Ozone app its project is. */
const callingApp = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const caller = yield* McpInvocationContext.requireThreadScope(scope, "This tool");
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const registry = yield* AppRegistry.AppRegistry;
  const shell = yield* threads
    .getThreadShell(caller.thread.threadId)
    .pipe(Effect.mapError(() => invalid("The calling thread could not be read.")));
  if (shell === null) return yield* invalid("The calling thread no longer exists.");
  const app = yield* registry.resolve(shell.projectId).pipe(Effect.mapError(fromApp));
  return { scope: caller, app };
});

/** The lead of a build: a thread of an Ozone app that is not itself one of the build's workers. */
const lead = Effect.gen(function* () {
  const { scope, app } = yield* callingApp;
  if (scope.thread.subagent === true) {
    return yield* invalid(
      "A worker does not run the build. Finish your own task; the lead thread does the rest.",
    );
  }
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const driver = (yield* providers.getProviders).find(
    (provider) => provider.instanceId === scope.thread.providerInstanceId,
  )?.driver;
  return {
    scope,
    threadId: scope.thread.threadId,
    app,
    patience: driver !== undefined && PATIENT_DRIVERS.has(driver) ? LONG_PATIENCE : SHORT_PATIENCE,
  } satisfies BuildConductor.BuildLead;
});

const conduct = Effect.fn("OzoneMcp.conduct")(function* <A>(
  use: (
    conductor: BuildConductor.BuildConductor["Service"],
    lead: BuildConductor.BuildLead,
  ) => Effect.Effect<A, OzoneAppError>,
) {
  const conductor = yield* BuildConductor.BuildConductor;
  return yield* use(conductor, yield* lead).pipe(Effect.mapError(fromApp));
});

export const layer = McpToolAccess.toLayer(OzoneToolkit, {
  ozone_build_get: McpToolAccess.readsAsCaller(() =>
    conduct((conductor, caller) => conductor.get(caller)),
  ),
  ozone_build_plan: McpToolAccess.actsAsCaller((input) =>
    conduct((conductor, caller) => conductor.plan(caller, input)),
  ),
  ozone_build_advance: McpToolAccess.actsAsCaller(() =>
    conduct((conductor, caller) => conductor.advance(caller)),
  ),
  ozone_build_resolve: McpToolAccess.actsAsCaller((input) =>
    conduct((conductor, caller) => conductor.resolve(caller, input)),
  ),
  ozone_build_check: McpToolAccess.actsAsCaller(() =>
    conduct((conductor, caller) => conductor.check(caller)),
  ),
  ozone_app_runtime: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { app } = yield* callingApp;
      const runtime = yield* AppRuntime.AppRuntime;
      const projectId = app.app.projectId;
      if (input.action === "logs") {
        const logs = yield* runtime
          .logs({
            projectId,
            ...(input.service === undefined ? {} : { service: input.service }),
            tail: input.tail ?? 120,
          })
          .pipe(Effect.mapError(fromApp));
        return {
          status: yield* runtime.status(projectId).pipe(Effect.mapError(fromApp)),
          logs: logs.text,
        };
      }
      const status =
        input.action === "status"
          ? runtime.status(projectId)
          : runtime.act({ projectId, action: input.action });
      return { status: yield* status.pipe(Effect.mapError(fromApp)) };
    }),
  ),
  ozone_app_create: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const apps = yield* OzoneApps.OzoneApps;
      const created = yield* apps.create({ name: input.name }).pipe(Effect.mapError(fromApp));
      return {
        projectId: created.app.projectId,
        workspaceRoot: created.workspaceRoot,
        url: ozoneAppUrl(created.app),
        next: "The app is starting. Start its build thread with t3_thread_launch in this project, with the user's request as the message, then tell the user where it is.",
      };
    }),
  ),
});
