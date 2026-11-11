import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as AnalyticsService from "../../telemetry/AnalyticsService.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as OzoneApps from "../apps/OzoneApps.ts";
import * as BuildConductor from "../build/BuildConductor.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as OzoneMcpHandlers from "./handlers.ts";
import { OzoneToolkit } from "./tools.ts";

// The MCP server rejects a tool whose schema it cannot advertise, and only when it starts.
it.effect("every Ozone tool registers with the MCP server", () =>
  Effect.gen(function* () {
    yield* Layer.build(
      McpHttpServer.toolkitRegistration(OzoneToolkit, OzoneMcpHandlers.layer).pipe(
        Layer.provide(McpHttpServer.layerInProcessMcpServer),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(BuildConductor.BuildConductor)({}),
            Layer.mock(AppRegistry.AppRegistry)({}),
            Layer.mock(AppRuntime.AppRuntime)({}),
            Layer.mock(OzoneApps.OzoneApps)({}),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(ProviderRegistry.ProviderRegistry)({}),
            Layer.mock(AnalyticsService.AnalyticsService)({}),
          ),
        ),
      ),
    );
    assert.deepStrictEqual(Object.keys(OzoneToolkit.tools).toSorted(), [
      "ozone_app_create",
      "ozone_app_runtime",
      "ozone_build_advance",
      "ozone_build_check",
      "ozone_build_get",
      "ozone_build_plan",
      "ozone_build_resolve",
    ]);
  }),
);
