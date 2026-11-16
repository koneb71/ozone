import {
  OZONE_MANIFEST_FILE_NAME,
  OzoneApp,
  OzoneAppError,
  OzoneAppManifest,
  OzoneAppSettings,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as ProjectService from "../../project/ProjectService.ts";
import { storageFailed } from "../errors.ts";

export interface ResolvedApp {
  readonly app: OzoneApp;
  readonly workspaceRoot: string;
  readonly manifest: OzoneAppManifest;
}

/** Which projects are Ozone apps, and where each one's folder and manifest are. */
export class AppRegistry extends Context.Service<
  AppRegistry,
  {
    readonly list: Effect.Effect<ReadonlyArray<OzoneApp>, OzoneAppError>;
    readonly resolve: (projectId: ProjectId) => Effect.Effect<ResolvedApp, OzoneAppError>;
    readonly register: (app: OzoneApp) => Effect.Effect<void, OzoneAppError>;
    readonly unregister: (projectId: ProjectId) => Effect.Effect<void, OzoneAppError>;
    /** Records the first healthy start. Later calls change nothing. */
    readonly markStarted: (projectId: ProjectId, at: string) => Effect.Effect<void, OzoneAppError>;
    /** Changes how the app's builds run, and returns the app as it is afterwards. */
    readonly configure: (
      projectId: ProjectId,
      change: Partial<OzoneAppSettings>,
    ) => Effect.Effect<OzoneApp, OzoneAppError>;
  }
>()("t3/ozone/apps/AppRegistry") {}

/**
 * Ozone's own table. It is created here, not through upstream's migration list: that list skips
 * ids below the highest one recorded, so sharing it would skip upstream's future migrations.
 */
const CREATE_APPS_TABLE = `CREATE TABLE IF NOT EXISTS ozone_apps (
  project_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL,
  port INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL
)`;

// Added after the first apps existed. SQLite has no "add column if missing", so a second run fails
// and is ignored.
const ADD_SETTINGS_COLUMN = `ALTER TABLE ozone_apps ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'`;
const ADD_FIRST_STARTED_COLUMN = `ALTER TABLE ozone_apps ADD COLUMN first_started_at TEXT`;

const SettingsJson = Schema.fromJsonString(OzoneAppSettings);
const encodeSettings = Schema.encodeEffect(SettingsJson);
const AppRow = Schema.Struct({ ...OzoneApp.fields, settings: SettingsJson });

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(OzoneAppManifest));

const notAnApp = new OzoneAppError({
  reason: "not_an_app",
  message: "This project is not an Ozone app.",
});

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectService.ProjectService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* sql.unsafe(CREATE_APPS_TABLE).pipe(Effect.orDie);
  yield* sql.unsafe(ADD_SETTINGS_COLUMN).pipe(Effect.ignore);
  yield* sql.unsafe(ADD_FIRST_STARTED_COLUMN).pipe(Effect.ignore);

  const columns = sql`
    project_id AS "projectId",
    slug AS "slug",
    name AS "name",
    template_id AS "templateId",
    port AS "port",
    created_at AS "createdAt",
    settings_json AS "settings",
    first_started_at AS "firstStartedAt"
  `;
  const selectApps = SqlSchema.findAll({
    Request: Schema.Void,
    Result: AppRow,
    execute: () => sql`SELECT ${columns} FROM ozone_apps ORDER BY created_at DESC`,
  });
  const selectApp = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: AppRow,
    execute: (projectId) => sql`SELECT ${columns} FROM ozone_apps WHERE project_id = ${projectId}`,
  });

  const readManifest = Effect.fn("AppRegistry.readManifest")(function* (workspaceRoot: string) {
    const invalid = (message: string) => () =>
      new OzoneAppError({ reason: "invalid_manifest", message });
    const text = yield* fs
      .readFileString(path.join(workspaceRoot, OZONE_MANIFEST_FILE_NAME))
      .pipe(Effect.mapError(invalid(`This app has no ${OZONE_MANIFEST_FILE_NAME}.`)));
    return yield* decodeManifest(text).pipe(
      Effect.mapError(invalid(`${OZONE_MANIFEST_FILE_NAME} is not a valid Ozone manifest.`)),
    );
  });

  return AppRegistry.of({
    list: selectApps(undefined).pipe(Effect.mapError(storageFailed("list its apps"))),
    resolve: Effect.fn("AppRegistry.resolve")(function* (projectId) {
      const app = yield* selectApp(projectId).pipe(Effect.mapError(storageFailed("read the app")));
      if (Option.isNone(app)) return yield* notAnApp;
      const project = yield* projects.getById(projectId).pipe(Effect.mapError(() => notAnApp));
      if (Option.isNone(project)) return yield* notAnApp;
      const workspaceRoot = project.value.workspaceRoot;
      return { app: app.value, workspaceRoot, manifest: yield* readManifest(workspaceRoot) };
    }),
    register: Effect.fn("AppRegistry.register")(
      function* (app) {
        const settings = yield* encodeSettings(app.settings);
        yield* sql`
        INSERT INTO ozone_apps (project_id, slug, name, template_id, port, created_at, settings_json)
        VALUES (${app.projectId}, ${app.slug}, ${app.name}, ${app.templateId}, ${app.port}, ${app.createdAt}, ${settings})
      `;
      },
      Effect.mapError(storageFailed("record the app")),
    ),
    configure: Effect.fn("AppRegistry.configure")(function* (projectId, change) {
      const app = yield* selectApp(projectId).pipe(Effect.mapError(storageFailed("read the app")));
      if (Option.isNone(app)) return yield* notAnApp;
      const settings = { ...app.value.settings, ...change };
      yield* encodeSettings(settings).pipe(
        Effect.flatMap(
          (json) =>
            sql`UPDATE ozone_apps SET settings_json = ${json} WHERE project_id = ${projectId}`,
        ),
        Effect.mapError(storageFailed("save the app's settings")),
      );
      return { ...app.value, settings };
    }),
    markStarted: Effect.fn("AppRegistry.markStarted")(function* (projectId, at) {
      yield* sql`
        UPDATE ozone_apps SET first_started_at = ${at}
        WHERE project_id = ${projectId} AND first_started_at IS NULL
      `.pipe(Effect.mapError(storageFailed("record that the app started")));
    }),
    unregister: Effect.fn("AppRegistry.unregister")(function* (projectId) {
      yield* sql`DELETE FROM ozone_apps WHERE project_id = ${projectId}`.pipe(
        Effect.mapError(storageFailed("forget the app")),
      );
    }),
  });
});

export const layer = Layer.effect(AppRegistry, make);
