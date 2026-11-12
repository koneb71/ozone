import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { OZONE_APP_INSTRUCTIONS } from "./appInstructions.ts";
import type { TemplateFile } from "./templates.ts";

const APP_NAME_TOKEN = "__OZONE_APP_NAME__";
const APP_SLUG_TOKEN = "__OZONE_APP_SLUG__";
const INSTRUCTIONS_TOKEN = "<!-- ozone:instructions -->";

export interface ScaffoldInput {
  readonly files: ReadonlyArray<TemplateFile>;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly slug: string;
  readonly port: number;
  readonly userId: number;
  readonly groupId: number;
  readonly authSecret: string;
}

/** The name is pasted into source files, so it must not be able to close a tag or a string. */
export const safeAppName = (name: string): string =>
  name
    .replace(/[<>{}"'`\\$]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "My app";

/** Compose project names are lowercase letters, digits and dashes, starting with a letter or digit. */
export const appSlug = (folderName: string, uniqueSuffix: string): string => {
  const base = folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = uniqueSuffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  return [base || "app", suffix].filter(Boolean).join("-");
};

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/** Null when the bytes are not text, so binary files are copied untouched. */
const decodeText = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};

const environmentFile = (input: ScaffoldInput): string =>
  [
    "# Written by Ozone for this machine. Not committed.",
    `OZONE_APP_PORT=${input.port}`,
    `OZONE_UID=${input.userId}`,
    `OZONE_GID=${input.groupId}`,
    `BETTER_AUTH_SECRET=${input.authSecret}`,
    "",
  ].join("\n");

const renderTemplateText = (text: string, input: ScaffoldInput): string =>
  text
    .replaceAll(APP_NAME_TOKEN, safeAppName(input.name))
    .replaceAll(APP_SLUG_TOKEN, input.slug)
    .replaceAll(INSTRUCTIONS_TOKEN, OZONE_APP_INSTRUCTIONS);

/** Copies a template into a new app's folder, filling in the app's name, slug and local settings. */
export const scaffold = Effect.fn("AppScaffolder.scaffold")(function* (input: ScaffoldInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const written: Array<string> = [];
  for (const file of input.files) {
    const target = path.join(input.workspaceRoot, ...file.path.split("/"));
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    const text = decodeText(file.bytes);
    yield* fs.writeFile(
      target,
      text === null ? file.bytes : encoder.encode(renderTemplateText(text, input)),
    );
    // Entry points such as `dev` must stay executable.
    yield* fs.chmod(target, file.mode);
    written.push(file.path);
  }
  yield* fs.writeFileString(path.join(input.workspaceRoot, ".env"), environmentFile(input));
  return written;
});
