/**
 * Where an app's environment variables are kept and how they reach its container. They live in
 * Ozone's state folder, never in the app's repository, in a file only its owner can read.
 */
import { OzoneEnvVariableValue } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const ENV_FILE_MODE = 0o600;

const EnvFile = Schema.fromJsonString(
  Schema.Struct({ variables: Schema.Array(OzoneEnvVariableValue) }),
);
const decodeEnvFile = Schema.decodeUnknownEffect(EnvFile);
export const encodeEnvFile = Schema.encodeEffect(EnvFile);

/** Beside the Compose override, in the app's folder of Ozone's state. */
export const envFilePath = (path: Path.Path, stateDir: string, slug: string) =>
  path.join(stateDir, "ozone", "apps", slug, "env.json");

/** The app's variables, or none when it has no file yet. A file that cannot be read is none. */
export const readEnvFile = (fs: FileSystem.FileSystem, file: string) =>
  fs.readFileString(file).pipe(
    Effect.flatMap(decodeEnvFile),
    Effect.map((stored) => stored.variables),
    Effect.orElseSucceed((): ReadonlyArray<OzoneEnvVariableValue> => []),
  );

/**
 * One YAML double-quoted value. JSON's escaping is valid YAML, and Compose would otherwise
 * read `$` as the start of an interpolation, so it is doubled.
 */
export const composeValue = (value: string) => JSON.stringify(value.split("$").join("$$"));
