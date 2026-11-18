/**
 * The tools Ozone adds to the `t3-code` MCP server. Descriptions and schemas are model-facing,
 * with no eval cases yet: after a change, run a real build and read what agents do.
 */
import {
  OrchestratorMcpFailure,
  OzoneBuildCheckResult,
  OzoneBuildPlanInput,
  OzoneBuildReport,
  OzoneBuildResolveInput,
  OzoneEnvVariable,
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
import * as AppEnv from "../env/AppEnv.ts";
import * as WebGuidance from "../guidance/WebGuidance.ts";
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
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagentsAndOutsideClients);

const BuildPlanTool = Tool.make("ozone_build_plan", {
  ...shared,
  description:
    "Set or revise this app's build plan. The first task is the thinnest slice the user can see working; a simple app is one to three tasks. Each task goes to a worker that sees only its brief. Finished tasks stay finished: keep them in the plan and add new ones. Then call ozone_build_advance.",
  parameters: OzoneBuildPlanInput,
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagentsAndOutsideClients);

const BuildAdvanceTool = Tool.make("ozone_build_advance", {
  ...shared,
  description:
    "Run the build. Gives each ready task to a worker, checks the result with the project's own checks, sends failures back for repair, and commits what passes. A call returns within about a minute, often before the work is done: follow `next` in the result. Safe to call again at any time: it continues where it was.",
  // No parameters: a plan that waits is started by the person, never by the agent that wrote it.
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagentsAndOutsideClients);

const BuildResolveTool = Tool.make("ozone_build_resolve", {
  ...shared,
  description: "Rule on a blocked task, then call ozone_build_advance.",
  parameters: OzoneBuildResolveInput,
  success: OzoneBuildReport,
  dependencies: leadDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagentsAndOutsideClients);

const BuildCheckTool = Tool.make("ozone_build_check", {
  ...shared,
  description:
    "Run this app's checks on the files as they are now, without committing. Use after a small direct edit.",
  success: OzoneBuildCheckResult,
  dependencies: leadDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const AppRuntimeTool = Tool.make("ozone_app_runtime", {
  ...shared,
  description:
    "This app's containers. `status` and `logs` read. `restart` restarts them. `rebuild` rebuilds the image, for a changed Dockerfile or compose file. The app's data is kept by all of them. `env` lists the environment variables the user set for the app; a secret's value is not shown.",
  parameters: Schema.Struct({
    action: Schema.Literals(["status", "logs", "restart", "rebuild", "env"]),
    service: Schema.optional(
      TrimmedNonEmptyString.annotate({ description: "For `logs`: one service, such as `app`." }),
    ),
    tail: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
  }),
  success: Schema.Struct({
    status: OzoneRuntimeStatus,
    logs: Schema.optional(Schema.String),
    env: Schema.optional(Schema.Array(OzoneEnvVariable)),
  }),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    AppRegistry.AppRegistry,
    AppRuntime.AppRuntime,
    AppEnv.AppEnv,
  ],
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const WebGuidanceTool = Tool.make("ozone_web_guidance", {
  ...shared,
  description:
    "Current guidance for HTML, CSS and browser APIs, from Chrome's Modern Web Guidance (CC BY 4.0), searched on this machine. Use it before writing a dialog, popover, form, validation, table, dark mode, images, fonts, animation, layout or anything else a browser renders. `search` takes a short query for one pattern, two to five words with no framework names, such as `light dismiss dialog`, and returns guide ids. `retrieve` returns up to three guides by id. Use this instead of the `modern-web-guidance` command.",
  parameters: Schema.Struct({
    action: Schema.Literals(["search", "retrieve"]),
    query: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(120)).annotate({
        description: "For `search`: the pattern, in two to five words.",
      }),
    ),
    ids: Schema.optional(
      Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(120)))
        .check(Schema.isMaxLength(WebGuidance.RETRIEVE_LIMIT))
        .annotate({ description: "For `retrieve`: guide ids from a search." }),
    ),
  }),
  success: Schema.Struct({
    matches: Schema.optional(
      Schema.Array(Schema.Struct({ id: Schema.String, description: Schema.String })),
    ),
    guides: Schema.optional(
      Schema.Array(Schema.Struct({ id: Schema.String, guide: Schema.String })),
    ),
  }),
  dependencies: [McpInvocationContext.McpInvocationContext, WebGuidance.WebGuidance],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const AppCreateTool = Tool.make("ozone_app_create", {
  ...shared,
  description:
    "Create a new app from Ozone's template and start its containers. Use when the user asks you to build an app. Then start its build thread with t3_thread_launch in the returned project, passing the user's request as the message.",
  parameters: Schema.Struct({
    name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)).annotate({
      description: "A short name for the app, such as `Habit tracker`.",
    }),
    template: Schema.optional(
      Schema.Literals(["web-app", "landing-page", "api-service"]).annotate({
        description:
          "`web-app` (default): pages, a database and sign-in. `landing-page`: a website with no database or accounts. `api-service`: a JSON API with a database and no pages.",
      }),
    ),
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
  WebGuidanceTool,
  AppCreateTool,
);
