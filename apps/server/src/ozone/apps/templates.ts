import type { OzoneTemplateSummary } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

export const DEFAULT_TEMPLATE_ID = "web-app";

export const TEMPLATES: ReadonlyArray<OzoneTemplateSummary> = [
  {
    id: DEFAULT_TEMPLATE_ID,
    name: "Full-stack web app",
    description:
      "TanStack Start with React, Tailwind and shadcn-style components, a Postgres database through Drizzle, and Better Auth sign-in. Runs in Docker Compose.",
    stack: ["TanStack Start", "React", "Tailwind", "Drizzle", "Postgres", "Better Auth"],
  },
];

export const findTemplate = (templateId: string): OzoneTemplateSummary | undefined =>
  TEMPLATES.find((template) => template.id === templateId);

/** Templates are plain source under `packages/ozone-templates/templates/<id>`. */
export const templateDirectory = Effect.fn("OzoneTemplates.templateDirectory")(function* (
  templateId: string,
) {
  const path = yield* Path.Path;
  // The URL is built from this module's own location, so it always converts.
  const root = yield* path
    .fromFileUrl(new URL("../../../../../packages/ozone-templates/templates/", import.meta.url))
    .pipe(Effect.orDie);
  return path.join(root, templateId);
});
