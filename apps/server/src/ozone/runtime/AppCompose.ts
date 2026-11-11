import { OzoneAppError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import type { ResolvedApp } from "../apps/AppRegistry.ts";
import * as DockerCli from "./DockerCli.ts";

export interface ComposeOptions {
  readonly timeout?: Duration.Input;
  readonly maxOutputBytes?: number;
  /** Set only by the user-confirmed "Delete app" flow, after its snapshot. */
  readonly allowDataRemoval?: true;
}

/** Runs a Docker Compose command against one app's project, wherever Ozone needs one. */
export class AppCompose extends Context.Service<
  AppCompose,
  {
    readonly run: (
      app: ResolvedApp,
      args: ReadonlyArray<string>,
      options?: ComposeOptions,
    ) => Effect.Effect<DockerCli.DockerRunOutput, OzoneAppError>;
  }
>()("t3/ozone/runtime/AppCompose") {}

const HOST_CA_MOUNT = "/ozone-host-ca.crt";

/** Lets the app's container trust the certificate authority this machine trusts. */
const hostCaOverride = (appService: string, hostCaPath: string): string =>
  [
    "services:",
    `  ${JSON.stringify(appService)}:`,
    "    environment:",
    `      NODE_EXTRA_CA_CERTS: ${JSON.stringify(HOST_CA_MOUNT)}`,
    `      SSL_CERT_FILE: ${JSON.stringify(HOST_CA_MOUNT)}`,
    "    volumes:",
    `      - ${JSON.stringify(`${hostCaPath}:${HOST_CA_MOUNT}:ro`)}`,
    "",
  ].join("\n");

const make = Effect.gen(function* () {
  const docker = yield* DockerCli.DockerCli;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const hostEnvironment = yield* HostProcess.Environment;

  /** The CA bundle the host trusts beyond the public roots, if it has one. */
  const hostCaPath = Effect.gen(function* () {
    const candidate = hostEnvironment.NODE_EXTRA_CA_CERTS ?? hostEnvironment.SSL_CERT_FILE;
    if (candidate === undefined || candidate.trim().length === 0) return null;
    const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    return exists ? candidate : null;
  });

  const projectArgs = Effect.fn("AppCompose.projectArgs")(function* (app: ResolvedApp) {
    const base = [
      "compose",
      "--project-directory",
      app.workspaceRoot,
      "-f",
      path.join(app.workspaceRoot, app.manifest.runtime.file),
    ];
    const ca = yield* hostCaPath;
    if (ca === null) return base;
    // Kept in Ozone's state, so the app's repository never names a path on this machine.
    const overridePath = path.join(
      config.stateDir,
      "ozone",
      "apps",
      app.app.slug,
      "compose.override.yaml",
    );
    const written = yield* fs.makeDirectory(path.dirname(overridePath), { recursive: true }).pipe(
      Effect.andThen(
        fs.writeFileString(overridePath, hostCaOverride(app.manifest.runtime.appService, ca)),
      ),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    return written ? [...base, "-f", overridePath] : base;
  });

  return AppCompose.of({
    run: Effect.fn("AppCompose.run")(function* (app, args, options) {
      const base = yield* projectArgs(app);
      return yield* docker
        .run({
          args: [...base, ...args],
          cwd: app.workspaceRoot,
          ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
          ...(options?.maxOutputBytes === undefined
            ? {}
            : { maxOutputBytes: options.maxOutputBytes }),
          ...(options?.allowDataRemoval === true ? { allowDataRemoval: true as const } : {}),
        })
        .pipe(
          Effect.mapError(
            (error) => new OzoneAppError({ reason: "docker_unavailable", message: error.detail }),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(AppCompose, make);
