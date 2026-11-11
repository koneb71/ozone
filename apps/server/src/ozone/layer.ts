import * as NetService from "@t3tools/shared/Net";
import * as Layer from "effect/Layer";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as AppRegistry from "./apps/AppRegistry.ts";
import * as OzoneApps from "./apps/OzoneApps.ts";
import * as BuildConductor from "./build/BuildConductor.ts";
import * as BuildGates from "./build/BuildGates.ts";
import * as BuildRepo from "./build/BuildRepo.ts";
import * as BuildStore from "./build/BuildStore.ts";
import * as BuildWorkers from "./build/BuildWorkers.ts";
import * as AppData from "./data/AppData.ts";
import * as OzoneMcpHandlers from "./mcp/handlers.ts";
import { OzoneToolkit } from "./mcp/tools.ts";
import * as AppCompose from "./runtime/AppCompose.ts";
import * as AppRuntime from "./runtime/AppRuntime.ts";
import * as DockerCli from "./runtime/DockerCli.ts";
import * as OzoneWs from "./ws.ts";

/** Ozone's services, shared by its WebSocket handlers and its MCP tools. */
export const layer = OzoneWs.layer.pipe(
  Layer.provideMerge(OzoneApps.layer),
  Layer.provideMerge(AppRuntime.layer),
  Layer.provideMerge(AppData.layer),
  Layer.provideMerge(AppCompose.layer),
  Layer.provideMerge(Layer.mergeAll(AppRegistry.layer, DockerCli.layer, BuildStore.layer)),
  Layer.provide(Layer.mergeAll(GitVcsDriver.layer, NetService.layer)),
);

/**
 * Ozone's tools, registered beside upstream's on the same MCP server. The conductor is built
 * here because the delegation service it drives only exists inside that server's layers.
 */
export const layerMcpTools = McpHttpServer.toolkitRegistration(
  OzoneToolkit,
  OzoneMcpHandlers.layer,
).pipe(
  Layer.provide(BuildConductor.layer),
  Layer.provide(Layer.mergeAll(BuildWorkers.layer, BuildGates.layer)),
  Layer.provide(Layer.mergeAll(BuildRepo.layer, OrchestratorMcpService.layer)),
  Layer.provide(GitVcsDriver.layer),
);
