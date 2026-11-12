import { OzoneAppError, type OzoneTemplateSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const DEFAULT_TEMPLATE_ID = "web-app";

export const TEMPLATES: ReadonlyArray<OzoneTemplateSummary> = [
  {
    id: DEFAULT_TEMPLATE_ID,
    name: "Web app",
    description:
      "TanStack Start with React, Tailwind and shadcn-style components, a Postgres database through Drizzle, and Better Auth sign-in. Runs in Docker Compose.",
    stack: ["TanStack Start", "React", "Tailwind", "Drizzle", "Postgres", "Better Auth"],
  },
  {
    id: "landing-page",
    name: "Landing page",
    description:
      "A website with no database and no accounts: TanStack Start with React, rendered on the server, Tailwind and shadcn-style components.",
    stack: ["TanStack Start", "React", "Tailwind"],
  },
  {
    id: "api-service",
    name: "API",
    description:
      "An HTTP JSON API with no pages: Hono on Node, a Postgres database through Drizzle, and request validation with zod.",
    stack: ["Hono", "Node", "Drizzle", "Postgres", "zod"],
  },
];

export const findTemplate = (templateId: string): OzoneTemplateSummary | undefined =>
  TEMPLATES.find((template) => template.id === templateId);

/** One file of a template: where it goes in the app, its permission bits and its bytes. */
export interface TemplateFile {
  readonly path: string;
  readonly mode: number;
  readonly bytes: Uint8Array;
}

/** Where templates live in a source checkout, from the repository's root. */
export const SOURCE_TEMPLATES_ROOT = "packages/ozone-templates/templates";
/**
 * A build writes every template into this one file beside the server. Packagers drop dotfiles and
 * file modes, and a template without its `.gitignore` would commit the app's `.env`.
 */
export const TEMPLATE_BUNDLE_FILE = "ozone-templates.json";

const TemplateBundle = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({ path: Schema.String, mode: Schema.Number, base64: Schema.String }),
    ),
  ),
);
const decodeBundle = Schema.decodeUnknownEffect(TemplateBundle);
const encodeBundle = Schema.encodeEffect(TemplateBundle);

/** A template folder's files in a stable order, with `/` in their paths on every platform. */
export const readTemplateTree = Effect.fn("OzoneTemplates.readTemplateTree")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: Array<TemplateFile> = [];
  for (const relativePath of (yield* fs.readDirectory(directory, { recursive: true })).toSorted()) {
    const source = path.join(directory, relativePath);
    const info = yield* fs.stat(source);
    if (info.type !== "File") continue;
    files.push({
      path: relativePath.split(path.sep).join("/"),
      mode: info.mode & 0o777,
      bytes: yield* fs.readFile(source),
    });
  }
  return files;
});

export const writeTemplateBundle = Effect.fn("OzoneTemplates.writeTemplateBundle")(function* (
  templatesRoot: string,
  outFile: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* Effect.forEach(TEMPLATES, (template) =>
    readTemplateTree(path.join(templatesRoot, template.id)).pipe(
      Effect.map(
        (files) =>
          [
            template.id,
            files.map((file) => ({
              path: file.path,
              mode: file.mode,
              base64: Buffer.from(file.bytes).toString("base64"),
            })),
          ] as const,
      ),
    ),
  );
  yield* fs.writeFileString(outFile, yield* encodeBundle(Object.fromEntries(entries)));
});

export const readTemplateBundle = Effect.fn("OzoneTemplates.readTemplateBundle")(function* (
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const bundle = yield* decodeBundle(yield* fs.readFileString(file));
  return new Map(
    Object.entries(bundle).map(([id, files]) => [
      id,
      files.map((entry): TemplateFile => ({
        path: entry.path,
        mode: entry.mode,
        bytes: new Uint8Array(Buffer.from(entry.base64, "base64")),
      })),
    ]),
  );
});

/**
 * A template's files: from the bundle beside a built server, or else from the source folders, as
 * seen from this module in `src` or from a server built without the bundle in `dist`.
 */
export const templateFiles = Effect.fn("OzoneTemplates.templateFiles")(function* (
  templateId: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const here = import.meta.dirname;
  const bundle = path.join(here, TEMPLATE_BUNDLE_FILE);
  if (yield* fs.exists(bundle)) {
    const files = (yield* readTemplateBundle(bundle)).get(templateId);
    if (files !== undefined) return files;
  } else {
    for (const up of ["../../../../..", "../../.."]) {
      const directory = path.resolve(here, up, SOURCE_TEMPLATES_ROOT, templateId);
      if (yield* fs.exists(directory)) return yield* readTemplateTree(directory);
    }
  }
  return yield* new OzoneAppError({
    reason: "failed",
    message: `Ozone could not find its ${templateId} template. Reinstall Ozone.`,
  });
});
