import * as NetService from "@t3tools/shared/Net";
import * as Layer from "effect/Layer";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as AppRegistry from "./apps/AppRegistry.ts";
import * as OzoneApps from "./apps/OzoneApps.ts";
import * as AppRuntime from "./runtime/AppRuntime.ts";
import * as DockerCli from "./runtime/DockerCli.ts";
import * as OzoneWs from "./ws.ts";

/** Every Ozone service, for the server's WebSocket and MCP transports. */
export const layer = OzoneWs.layer.pipe(
  Layer.provideMerge(OzoneApps.layer),
  Layer.provideMerge(AppRuntime.layer),
  Layer.provideMerge(Layer.mergeAll(AppRegistry.layer, DockerCli.layer)),
  Layer.provide(Layer.mergeAll(GitVcsDriver.layer, NetService.layer)),
);
