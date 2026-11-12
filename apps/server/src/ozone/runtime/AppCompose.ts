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
import { composeValue, ENV_FILE_MODE, envFilePath, readEnvFile } from "../env/envFile.ts";
import * as DockerCli from "./DockerCli.ts";
import { hostCaPath } from "./hostCa.ts";

export interface ComposeOptions {
  readonly timeout?: Duration.Input;
  readonly maxOutputBytes?: number;
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

/**
 * What Ozone adds to an app's own compose file, for its app service: trust in the certificate
 * authority this machine trusts, and the variables the person set. Null when there is neither.
 */
export const composeOverride = (
  appService: string,
  input: {
    readonly hostCaPath: string | null;
    readonly variables: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  },
): string | null => {
  const environment = new Map<string, string>(
    input.hostCaPath === null
      ? []
      : [
          ["NODE_EXTRA_CA_CERTS", HOST_CA_MOUNT],
          ["SSL_CERT_FILE", HOST_CA_MOUNT],
        ],
  );
  for (const variable of input.variables) environment.set(variable.name, variable.value);
  if (environment.size === 0) return null;
  return [
    "services:",
    `  ${JSON.stringify(appService)}:`,
    "    environment:",
    ...[...environment].map(([name, value]) => `      ${name}: ${composeValue(value)}`),
    ...(input.hostCaPath === null
      ? []
      : ["    volumes:", `      - ${composeValue(`${input.hostCaPath}:${HOST_CA_MOUNT}:ro`)}`]),
    "",
  ].join("\n");
};

const make = Effect.gen(function* () {
  const docker = yield* DockerCli.DockerCli;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const hostEnvironment = yield* HostProcess.Environment;

  const projectArgs = Effect.fn("AppCompose.projectArgs")(function* (app: ResolvedApp) {
    const base = [
      "compose",
      // Named by the slug, never by a compose file an agent can edit to aim at another project.
      "--project-name",
      app.app.slug,
      "--project-directory",
      app.workspaceRoot,
      "-f",
      path.join(app.workspaceRoot, app.manifest.runtime.file),
    ];
    const override = composeOverride(app.manifest.runtime.appService, {
      hostCaPath: yield* hostCaPath(hostEnvironment, fs),
      variables: yield* readEnvFile(fs, envFilePath(path, config.stateDir, app.app.slug)),
    });
    if (override === null) return base;
    // Kept in Ozone's state, so the app's repository never names a path or holds a secret.
    const overridePath = path.join(
      config.stateDir,
      "ozone",
      "apps",
      app.app.slug,
      "compose.override.yaml",
    );
    const written = yield* fs.makeDirectory(path.dirname(overridePath), { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(overridePath, override, { mode: ENV_FILE_MODE })),
      Effect.andThen(fs.chmod(overridePath, ENV_FILE_MODE)),
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
