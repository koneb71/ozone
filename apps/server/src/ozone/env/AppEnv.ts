import {
  OzoneAppError,
  type OzoneEnvListResult,
  type OzoneEnvRemoveInput,
  type OzoneEnvSetInput,
  type OzoneEnvVariableValue,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { ENV_FILE_MODE, encodeEnvFile, envFilePath, readEnvFile } from "./envFile.ts";

/**
 * An app's environment variables: settings and secrets the person gives it, which reach its
 * container and never its repository.
 */
export class AppEnv extends Context.Service<
  AppEnv,
  {
    /** A secret's value is never in the list. */
    readonly list: (projectId: ProjectId) => Effect.Effect<OzoneEnvListResult, OzoneAppError>;
    /** Adds or replaces one, and recreates the app's container so it reads it. */
    readonly set: (input: OzoneEnvSetInput) => Effect.Effect<OzoneEnvListResult, OzoneAppError>;
    readonly remove: (
      input: OzoneEnvRemoveInput,
    ) => Effect.Effect<OzoneEnvListResult, OzoneAppError>;
  }
>()("t3/ozone/env/AppEnv") {}

const shown = (variables: ReadonlyArray<OzoneEnvVariableValue>): OzoneEnvListResult => ({
  variables: variables.map((variable) => ({
    name: variable.name,
    secret: variable.secret,
    value: variable.secret ? null : variable.value,
  })),
});
const saveFailed = () =>
  new OzoneAppError({ reason: "failed", message: "Ozone could not save the variables." });

const make = Effect.gen(function* () {
  const registry = yield* AppRegistry.AppRegistry;
  const runtime = yield* AppRuntime.AppRuntime;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const writing = yield* Semaphore.make(1);

  const fileOf = (app: AppRegistry.ResolvedApp) => envFilePath(path, config.stateDir, app.app.slug);

  const change = Effect.fn("AppEnv.change")(function* (
    projectId: ProjectId,
    edit: (current: ReadonlyArray<OzoneEnvVariableValue>) => ReadonlyArray<OzoneEnvVariableValue>,
  ) {
    const app = yield* registry.resolve(projectId);
    const file = fileOf(app);
    const next = edit(yield* readEnvFile(fs, file)).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    );
    yield* Effect.gen(function* () {
      const json = yield* encodeEnvFile({ variables: next });
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(file, ENV_FILE_MODE);
    }).pipe(Effect.mapError(saveFailed));
    // A container reads its environment when it is created; a stopped app reads it when it starts.
    const { phase } = yield* runtime.status(projectId);
    if (phase !== "stopped" && phase !== "unavailable") {
      yield* runtime.apply(projectId).pipe(Effect.ignore);
    }
    return shown(next);
  });

  return AppEnv.of({
    list: Effect.fn("AppEnv.list")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      return shown(yield* readEnvFile(fs, fileOf(app)));
    }),
    set: Effect.fn("AppEnv.set")((input) =>
      writing.withPermits(1)(
        change(input.projectId, (current) => [
          ...current.filter((variable) => variable.name !== input.name),
          { name: input.name, value: input.value, secret: input.secret },
        ]),
      ),
    ),
    remove: Effect.fn("AppEnv.remove")((input) =>
      writing.withPermits(1)(
        change(input.projectId, (current) =>
          current.filter((variable) => variable.name !== input.name),
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(AppEnv, make);
