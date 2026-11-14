import * as NetService from "@t3tools/shared/Net";
import * as Layer from "effect/Layer";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as AppRegistry from "./apps/AppRegistry.ts";
import * as OzoneApps from "./apps/OzoneApps.ts";
import * as BuildChecks from "./builds/BuildChecks.ts";
import * as BuildConductor from "./builds/BuildConductor.ts";
import * as BuildGates from "./builds/BuildGates.ts";
import * as BuildPreview from "./builds/BuildPreview.ts";
import * as BuildRepo from "./builds/BuildRepo.ts";
import * as BuildReview from "./builds/BuildReview.ts";
import * as BuildStore from "./builds/BuildStore.ts";
import * as BuildWake from "./builds/BuildWake.ts";
import * as BuildWorkers from "./builds/BuildWorkers.ts";
import * as AppData from "./data/AppData.ts";
import * as AppDeploy from "./deploy/AppDeploy.ts";
import * as AppServers from "./deploy/AppServers.ts";
import * as AutoDeploy from "./deploy/AutoDeploy.ts";
import * as Dokploy from "./deploy/Dokploy.ts";
import * as DokployDeploy from "./deploy/DokployDeploy.ts";
import * as GitHubDeployKeys from "./deploy/GitHubDeployKeys.ts";
import * as HostedDeploy from "./deploy/HostedDeploy.ts";
import * as HostDrivers from "./deploy/hosts/drivers.ts";
import * as Notifier from "./deploy/Notifier.ts";
import * as SavedServers from "./deploy/SavedServers.ts";
import * as SshAccess from "./deploy/SshAccess.ts";
import * as OzoneDeployWebhook from "./deploy/webhook.ts";
import * as AppEnv from "./env/AppEnv.ts";
import * as AppHistory from "./history/AppHistory.ts";
import * as OzoneMcpHandlers from "./mcp/handlers.ts";
import * as OzoneRelease from "./OzoneRelease.ts";
import { OzoneToolkit } from "./mcp/tools.ts";
import * as AppCompose from "./runtime/AppCompose.ts";
import * as AppRuntime from "./runtime/AppRuntime.ts";
import * as DockerCli from "./runtime/DockerCli.ts";
import * as OzoneWs from "./ws.ts";

/**
 * Ozone's services, shared by its WebSocket handlers and its MCP tools. The checks are here and
 * not with the conductor: they run as jobs of the server, whoever asked for them.
 */
export const layer = Layer.mergeAll(OzoneWs.layer, AutoDeploy.layer).pipe(
  Layer.provideMerge(OzoneApps.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      BuildChecks.layer,
      BuildReview.layer,
      AppHistory.layer,
      AppEnv.layer,
      AppDeploy.layer,
      BuildPreview.layer,
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(DokployDeploy.layer, HostedDeploy.layer)),
  Layer.provideMerge(SavedServers.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      AppServers.layer,
      Notifier.layer,
      Dokploy.layer,
      HostDrivers.layer,
      GitHubDeployKeys.layer,
      OzoneRelease.layer,
    ),
  ),
  Layer.provideMerge(BuildGates.layer),
  Layer.provideMerge(AppRuntime.layer),
  Layer.provideMerge(AppData.layer),
  Layer.provideMerge(AppCompose.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      AppRegistry.layer,
      DockerCli.layer,
      BuildStore.layer,
      BuildRepo.layer,
      BuildWake.layer,
      AppServers.layerServerShell,
    ),
  ),
  // Below Docker and the shell, so both reach servers with Ozone's key.
  Layer.provideMerge(SshAccess.layer),
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
  Layer.provide(BuildWorkers.layer),
  Layer.provide(OrchestratorMcpService.layer),
);

/** The URL that deploys an app, among the server's HTTP routes. */
export const layerRoutes = OzoneDeployWebhook.routeLayer;
