import {
  OzoneAppError,
  type OzoneDeployEnvListInput,
  type OzoneDeployEnvRemoveInput,
  type OzoneDeployEnvSetInput,
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
import {
  ENV_FILE_MODE,
  encodeEnvFile,
  envFilePath,
  placeKey,
  readStoredEnv,
  shownVariables as shown,
  type StoredEnv,
} from "./envFile.ts";

/**
 * An app's environment variables: settings and secrets the person gives it, which reach its
 * container and never its repository. Its own apply wherever it runs; the ones it has for a
 * place it deploys to apply only there, over its own of the same name.
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
    /** The app's variables for one place it deploys to. */
    readonly listAt: (
      input: OzoneDeployEnvListInput,
    ) => Effect.Effect<OzoneEnvListResult, OzoneAppError>;
    /** Adds or replaces one there. Production reads it at the next deploy. */
    readonly setAt: (
      input: OzoneDeployEnvSetInput,
    ) => Effect.Effect<OzoneEnvListResult, OzoneAppError>;
    readonly removeAt: (
      input: OzoneDeployEnvRemoveInput,
    ) => Effect.Effect<OzoneEnvListResult, OzoneAppError>;
  }
>()("t3/ozone/env/AppEnv") {}

type Variables = ReadonlyArray<OzoneEnvVariableValue>;
const saveFailed = () =>
  new OzoneAppError({ reason: "failed", message: "Ozone could not save the variables." });
const sorted = (variables: Variables) => variables.toSorted((a, b) => a.name.localeCompare(b.name));
const withOne = (variable: OzoneEnvVariableValue) => (current: Variables) => [
  ...current.filter((entry) => entry.name !== variable.name),
  variable,
];
const without = (name: string) => (current: Variables) =>
  current.filter((entry) => entry.name !== name);

const make = Effect.gen(function* () {
  const registry = yield* AppRegistry.AppRegistry;
  const runtime = yield* AppRuntime.AppRuntime;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const writing = yield* Semaphore.make(1);

  const fileOf = (app: AppRegistry.ResolvedApp) => envFilePath(path, config.stateDir, app.app.slug);

  const save = Effect.fn("AppEnv.save")(function* (
    projectId: ProjectId,
    edit: (stored: StoredEnv) => StoredEnv,
  ) {
    const app = yield* registry.resolve(projectId);
    const file = fileOf(app);
    const next = edit(yield* readStoredEnv(fs, file));
    yield* Effect.gen(function* () {
      const json = yield* encodeEnvFile(next);
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, json, { mode: ENV_FILE_MODE });
      yield* fs.chmod(file, ENV_FILE_MODE);
    }).pipe(Effect.mapError(saveFailed));
    return next;
  });

  const change = Effect.fn("AppEnv.change")(function* (
    projectId: ProjectId,
    edit: (current: Variables) => Variables,
  ) {
    const next = yield* save(projectId, (stored) => ({
      ...stored,
      variables: sorted(edit(stored.variables)),
    }));
    // A container reads its environment when it is created; a stopped app reads it when it starts.
    const { phase } = yield* runtime.status(projectId);
    if (phase !== "stopped" && phase !== "unavailable") {
      yield* runtime.apply(projectId).pipe(Effect.ignore);
    }
    return shown(next.variables);
  });

  // Production reads these at its next deploy, so nothing is restarted for them.
  const changeAt = Effect.fn("AppEnv.changeAt")(function* (
    input: OzoneDeployEnvListInput,
    edit: (current: Variables) => Variables,
  ) {
    const key = placeKey(input.place);
    const next = yield* save(input.projectId, (stored) => ({
      ...stored,
      places: { ...stored.places, [key]: sorted(edit(stored.places[key] ?? [])) },
    }));
    return shown(next.places[key] ?? []);
  });

  return AppEnv.of({
    list: Effect.fn("AppEnv.list")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      return shown((yield* readStoredEnv(fs, fileOf(app))).variables);
    }),
    set: Effect.fn("AppEnv.set")((input) =>
      writing.withPermits(1)(
        change(
          input.projectId,
          withOne({ name: input.name, value: input.value, secret: input.secret }),
        ),
      ),
    ),
    remove: Effect.fn("AppEnv.remove")((input) =>
      writing.withPermits(1)(change(input.projectId, without(input.name))),
    ),
    listAt: Effect.fn("AppEnv.listAt")(function* (input) {
      const app = yield* registry.resolve(input.projectId);
      const stored = yield* readStoredEnv(fs, fileOf(app));
      return shown(stored.places[placeKey(input.place)] ?? []);
    }),
    setAt: Effect.fn("AppEnv.setAt")((input) =>
      writing.withPermits(1)(
        changeAt(input, withOne({ name: input.name, value: input.value, secret: input.secret })),
      ),
    ),
    removeAt: Effect.fn("AppEnv.removeAt")((input) =>
      writing.withPermits(1)(changeAt(input, without(input.name))),
    ),
  });
});

export const layer = Layer.effect(AppEnv, make);
