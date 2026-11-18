import type { OzoneAppError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeModule from "node:module";

import { failed } from "../errors.ts";

// Chrome's Modern Web Guidance reads its index and guides beside its module, so it stays out of
// the bundle. Only its search module is loaded: its CLI fetches itself from npm on every run and
// sends the queries to Google.
const requireGuidance = NodeModule.createRequire(import.meta.url);
const SKILL_DIR = "skills/modern-web-guidance";
/** How many guides one search returns, and one call may read. */
export const SEARCH_LIMIT = 5;
export const RETRIEVE_LIMIT = 3;

const SearchModule = Schema.Struct({ searchUseCases: Schema.Any });
const Found = Schema.Array(
  Schema.Struct({ id: Schema.String, description: Schema.String, category: Schema.String }),
);
const Features = Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String })));
const GuideIndex = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      category: Schema.String,
      originTrials: Features,
      volatileFeatures: Features,
    }),
  ),
);

const decodeSearchModule = Schema.decodeUnknownEffect(SearchModule);
const decodeFound = Schema.decodeUnknownEffect(Found);
const decodeGuideIndex = Schema.decodeEffect(GuideIndex);

export interface GuidanceMatch {
  readonly id: string;
  readonly description: string;
}

export interface GuidanceGuide {
  readonly id: string;
  readonly guide: string;
}

/** Current guidance for HTML, CSS and browser APIs, searched and read on this machine. */
export class WebGuidance extends Context.Service<
  WebGuidance,
  {
    readonly search: (query: string) => Effect.Effect<ReadonlyArray<GuidanceMatch>, OzoneAppError>;
    readonly retrieve: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<GuidanceGuide>, OzoneAppError>;
  }
>()("t3/ozone/guidance/WebGuidance") {}

const unavailable = (cause: unknown) =>
  failed(`Ozone's web guidance is not available: ${String(cause)}`);

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Loaded on the first call: the index takes about 10 MB once read.
  const load = yield* Effect.cached(
    Effect.gen(function* () {
      const root = path.join(
        path.dirname(requireGuidance.resolve("modern-web-guidance/package.json")),
        SKILL_DIR,
      );
      const search = yield* decodeSearchModule(
        requireGuidance(`modern-web-guidance/${SKILL_DIR}/search.mjs`),
      );
      const index = yield* decodeGuideIndex(
        yield* fs.readFileString(path.join(root, "gen", "guides.json")),
      );
      return {
        root,
        searchUseCases: search.searchUseCases as (query: string, limit: number) => Promise<unknown>,
        guides: new Map(index.map((entry) => [entry.id, entry])),
      };
    }).pipe(Effect.mapError(unavailable)),
  );

  return WebGuidance.of({
    search: Effect.fn("WebGuidance.search")(function* (query) {
      const { searchUseCases } = yield* load;
      const found = yield* Effect.tryPromise({
        try: () => searchUseCases(query, SEARCH_LIMIT),
        catch: unavailable,
      });
      const matches = yield* decodeFound(found).pipe(Effect.mapError(unavailable));
      return matches.map((match) => ({ id: match.id, description: match.description }));
    }),
    retrieve: Effect.fn("WebGuidance.retrieve")(function* (ids) {
      const { root, guides } = yield* load;
      return yield* Effect.forEach(ids.slice(0, RETRIEVE_LIMIT), (id) =>
        Effect.gen(function* () {
          const entry = guides.get(id);
          if (entry === undefined) {
            return yield* failed(`No guide is named ${id}. Search first and use an id it returns.`);
          }
          const text = yield* fs
            .readFileString(path.join(root, "guides", entry.category, `${id}.md`))
            .pipe(Effect.mapError(unavailable));
          // Upstream asks the project to opt in to these; a note keeps the choice with the agent.
          const unsettled = [...(entry.originTrials ?? []), ...(entry.volatileFeatures ?? [])];
          const note =
            unsettled.length === 0
              ? ""
              : `> Uses features that are experimental or still changing (${unsettled.map((feature) => feature.id).join(", ")}). Use them only with a fallback that works without them, or ask the user first.\n\n`;
          return { id, guide: note + text };
        }),
      );
    }),
  });
});

export const layer = Layer.effect(WebGuidance, make);
