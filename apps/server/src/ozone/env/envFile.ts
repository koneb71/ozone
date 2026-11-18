/**
 * Where an app's environment variables are kept and how they reach its container. They live in
 * Ozone's state folder, never in the app's repository, in a file only its owner can read.
 */
import {
  OzoneEnvVariableValue,
  type OzoneDeployPlace,
  type OzoneEnvListResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const ENV_FILE_MODE = 0o600;

const EnvFile = Schema.fromJsonString(
  Schema.Struct({
    variables: Schema.Array(OzoneEnvVariableValue),
    /** The app's variables for one place it deploys to, by `placeKey`. Older files have none. */
    places: Schema.Record(Schema.String, Schema.Array(OzoneEnvVariableValue)).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed({})),
    ),
  }),
);
export type StoredEnv = (typeof EnvFile)["Type"];
const decodeEnvFile = Schema.decodeUnknownEffect(EnvFile);
export const encodeEnvFile = Schema.encodeEffect(EnvFile);

/** Variables as a client sees them: a secret's value never leaves the server. */
export const shownVariables = (
  variables: ReadonlyArray<OzoneEnvVariableValue>,
): OzoneEnvListResult => ({
  variables: variables.map((variable) => ({
    name: variable.name,
    secret: variable.secret,
    value: variable.secret ? null : variable.value,
  })),
});

/** Beside the Compose override, in the app's folder of Ozone's state. */
export const envFilePath = (path: Path.Path, stateDir: string, slug: string) =>
  path.join(stateDir, "ozone", "apps", slug, "env.json");

/** Names a place a deploy runs, the same for every deploy there. */
export const placeKey = (place: OzoneDeployPlace) =>
  place.dokploy !== null
    ? `dokploy:${place.dokploy}`
    : place.hosted !== null
      ? `hosted:${place.hosted}`
      : place.host === null
        ? "here"
        : `ssh:${place.host}`;

/** Everything in the app's file, or nothing when it has none yet or it cannot be read. */
export const readStoredEnv = (fs: FileSystem.FileSystem, file: string) =>
  fs.readFileString(file).pipe(
    Effect.flatMap(decodeEnvFile),
    Effect.orElseSucceed((): StoredEnv => ({ variables: [], places: {} })),
  );

/** The app's own variables, which it has everywhere it runs. */
export const readEnvFile = (fs: FileSystem.FileSystem, file: string) =>
  Effect.map(readStoredEnv(fs, file), (stored) => stored.variables);

/**
 * One YAML double-quoted value. JSON's escaping is valid YAML, and Compose would otherwise
 * read `$` as the start of an interpolation, so it is doubled.
 */
export const composeValue = (value: string) => JSON.stringify(value.split("$").join("$$"));
