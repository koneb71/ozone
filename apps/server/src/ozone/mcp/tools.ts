/**
 * The tools Ozone adds to the `t3-code` MCP server. Descriptions and schemas are model-facing,
 * with no eval cases yet: after a change, run a real build and read what agents do.
 */
import {
  OrchestratorMcpFailure,
  OzoneBuildAdvanceInput,
  OzoneBuildCheckResult,
  OzoneBuildPlanInput,
  OzoneBuildReport,
  OzoneBuildResolveInput,
  OzoneRuntimeStatus,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as McpSchema from "effect/ai/McpSchema";
import * as Schema from "effect/Schema";

import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as OzoneApps from "../apps/OzoneApps.ts";
import * as BuildConductor from "../builds/BuildConductor.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";

// A tool that takes nothing declares no `parameters`: MCP needs an object schema, and Tool.make
// supplies one.
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
};
const leadDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ProviderRegistry.ProviderRegistry,
  AppRegistry.AppRegistry,
  BuildConductor.BuildConductor,
];

const BuildGetTool = Tool.make("ozone_build_get", {
  ...shared,
  description: "Read this app's build: the tasks, where each stands, and what to do next.",
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const BuildPlanTool = Tool.make("ozone_build_plan", {
  ...shared,
  description:
    "Set or revise this app's build plan. The first task is the thinnest slice the user can see working; a simple app is one to three tasks. Each task goes to a worker that sees only its brief. Finished tasks stay finished: keep them in the plan and add new ones. Then call ozone_build_advance.",
  parameters: OzoneBuildPlanInput,
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const BuildAdvanceTool = Tool.make("ozone_build_advance", {
  ...shared,
  description:
    "Run the build. Gives each ready task to a worker, checks the result with the project's own checks, sends failures back for repair, and commits what passes. A call returns within about a minute, often before the work is done: follow `next` in the result. Safe to call again at any time: it continues where it was.",
  parameters: OzoneBuildAdvanceInput,
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const BuildResolveTool = Tool.make("ozone_build_resolve", {
  ...shared,
  description: "Rule on a blocked task, then call ozone_build_advance.",
  parameters: OzoneBuildResolveInput,
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const BuildCheckTool = Tool.make("ozone_build_check", {
  ...shared,
  description:
    "Run this app's checks on the files as they are now, without committing. Use after a small direct edit.",
  success: OzoneBuildCheckResult,
  dependencies: leadDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const AppRuntimeTool = Tool.make("ozone_app_runtime", {
  ...shared,
  description:
    "This app's containers. `status` and `logs` read. `restart` restarts them. `rebuild` rebuilds the image, for a changed Dockerfile or compose file. The app's data is kept by all of them.",
  parameters: Schema.Struct({
    action: Schema.Literals(["status", "logs", "restart", "rebuild"]),
    service: Schema.optional(
      TrimmedNonEmptyString.annotate({ description: "For `logs`: one service, such as `app`." }),
    ),
    tail: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
  }),
  success: Schema.Struct({
    status: OzoneRuntimeStatus,
    logs: Schema.optional(Schema.String),
  }),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    AppRegistry.AppRegistry,
    AppRuntime.AppRuntime,
  ],
}).annotate(Tool.Destructive, false);

const AppCreateTool = Tool.make("ozone_app_create", {
  ...shared,
  description:
    "Create a new app from Ozone's template and start its containers. Use when the user asks you to build an app. Then start its build thread with t3_thread_launch in the returned project, passing the user's request as the message.",
  parameters: Schema.Struct({
    name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)).annotate({
      description: "A short name for the app, such as `Habit tracker`.",
    }),
  }),
  success: Schema.Struct({
    projectId: ProjectId,
    workspaceRoot: Schema.String,
    url: Schema.String,
    next: Schema.String,
  }),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    OzoneApps.OzoneApps,
  ],
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

export const OzoneToolkit = Toolkit.make(
  BuildGetTool,
  BuildPlanTool,
  BuildAdvanceTool,
  BuildResolveTool,
  BuildCheckTool,
  AppRuntimeTool,
  AppCreateTool,
);
