import {
  OzoneAppError,
  OzoneSnapshot,
  type OzoneDataRestoreInput,
  type OzoneDataRestoreResult,
  type OzoneSnapshotReason,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppCompose from "../runtime/AppCompose.ts";

export interface SnapshotInput {
  readonly projectId: ProjectId;
  readonly reason: OzoneSnapshotReason;
  readonly label?: string;
}

/**
 * Copies of an app's data, kept in Ozone's home so they outlive the app's containers, its
 * checkout and the app itself. See docs/ozone/data-safety.md.
 */
export class AppData extends Context.Service<
  AppData,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<OzoneSnapshot>, OzoneAppError>;
    readonly snapshot: (input: SnapshotInput) => Effect.Effect<OzoneSnapshot, OzoneAppError>;
    /** Replaces the app's data with a snapshot, after taking one of the data as it is now. */
    readonly restore: (
      input: OzoneDataRestoreInput,
    ) => Effect.Effect<OzoneDataRestoreResult, OzoneAppError>;
  }
>()("t3/ozone/data/AppData") {}

const SNAPSHOT_FILE = "snapshot.json";
const CONTAINER_DUMP = "/tmp/ozone-snapshot.dump";
/** Snapshots Ozone takes by itself are pruned to this many per app. Manual ones are kept. */
const AUTOMATIC_SNAPSHOTS_KEPT = 20;
const DUMP_TIMEOUT = Duration.minutes(15);

/** What a snapshot folder records: the snapshot, and which file holds which service's data. */
const StoredSnapshot = Schema.Struct({
  snapshot: OzoneSnapshot,
  files: Schema.Array(
    Schema.Struct({
      service: Schema.String,
      file: Schema.String,
      database: Schema.String,
      user: Schema.String,
    }),
  ),
});
type StoredSnapshot = typeof StoredSnapshot.Type;
const StoredSnapshotJson = Schema.fromJsonString(StoredSnapshot);
const decodeStored = Schema.decodeUnknownEffect(StoredSnapshotJson);
const encodeStored = Schema.encodeEffect(StoredSnapshotJson);

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

export const make = Effect.gen(function* () {
  const registry = yield* AppRegistry.AppRegistry;
  const compose = yield* AppCompose.AppCompose;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const random = yield* SecureRandom.SecureRandom;
  // One data operation at a time: a restore must never overlap a snapshot of the same database.
  const working = yield* Semaphore.make(1);

  const backupsRoot = path.join(config.stateDir, "ozone", "backups");
  const appDirectory = (app: AppRegistry.ResolvedApp) => path.join(backupsRoot, app.app.slug);

  /** Runs a Compose command and turns a non-zero exit into a failure that says what was tried. */
  const run = Effect.fn("AppData.run")(function* (
    app: AppRegistry.ResolvedApp,
    doing: string,
    args: ReadonlyArray<string>,
  ) {
    const output = yield* compose.run(app, args, { timeout: DUMP_TIMEOUT });
    if (output.code !== 0) {
      const detail = (output.stderr.trim() || output.stdout.trim()).slice(-600);
      return yield* failed(`Could not ${doing}.${detail.length === 0 ? "" : ` ${detail}`}`);
    }
    return output;
  });

  const isRunning = (app: AppRegistry.ResolvedApp, service: string) =>
    compose
      .run(app, ["ps", "--status", "running", "--quiet", service])
      .pipe(Effect.map((output) => output.code === 0 && output.stdout.trim().length > 0));

  /** Runs `use` with the service up, and puts a service that was stopped back to stopped. */
  const withServiceUp = Effect.fn("AppData.withServiceUp")(function* <A>(
    app: AppRegistry.ResolvedApp,
    service: string,
    use: Effect.Effect<A, OzoneAppError>,
  ) {
    const wasRunning = yield* isRunning(app, service);
    yield* run(app, `start the ${service} service`, ["up", "--detach", "--wait", service]);
    return yield* use.pipe(
      Effect.ensuring(
        wasRunning ? Effect.void : compose.run(app, ["stop", service]).pipe(Effect.ignore),
      ),
    );
  });

  const readStored = (directory: string) =>
    fs
      .readFileString(path.join(directory, SNAPSHOT_FILE))
      .pipe(Effect.flatMap(decodeStored), Effect.option);

  const listStored = Effect.fn("AppData.listStored")(function* (app: AppRegistry.ResolvedApp) {
    const directory = appDirectory(app);
    const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
    const stored = yield* Effect.forEach(names, (name) => readStored(path.join(directory, name)));
    return stored
      .flatMap(Option.toArray)
      .toSorted((left, right) => right.snapshot.id.localeCompare(left.snapshot.id));
  });

  const prune = Effect.fn("AppData.prune")(function* (app: AppRegistry.ResolvedApp) {
    const automatic = (yield* listStored(app)).filter(
      (stored) => stored.snapshot.reason !== "manual",
    );
    yield* Effect.forEach(
      automatic.slice(AUTOMATIC_SNAPSHOTS_KEPT),
      (stored) =>
        fs
          .remove(path.join(appDirectory(app), stored.snapshot.id), { recursive: true })
          .pipe(Effect.ignore),
      { discard: true },
    );
  });

  const headCommit = (workspaceRoot: string) =>
    git
      .execute({
        operation: "AppData.headCommit",
        cwd: workspaceRoot,
        args: ["rev-parse", "HEAD"],
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.map((result) => {
          const sha = result.stdout.trim();
          return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
        }),
        Effect.orElseSucceed(() => null),
      );

  const takeSnapshot = Effect.fn("AppData.takeSnapshot")(function* (
    app: AppRegistry.ResolvedApp,
    input: SnapshotInput,
  ) {
    const now = yield* DateTime.now;
    const suffix = yield* random.uuidV4().pipe(
      Effect.map((uuid) => uuid.slice(0, 8)),
      Effect.mapError(() => failed("Could not name the snapshot.")),
    );
    // Sorts by time, so the newest snapshot is the last folder name.
    const id = `${DateTime.formatIso(now).replace(/[-:.]/g, "")}-${suffix}`;
    const directory = path.join(appDirectory(app), id);
    yield* fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(() => failed("Could not create the snapshot folder.")));

    const databases = app.manifest.data.services.filter((service) => service.kind === "postgres");
    const files = yield* Effect.forEach(databases, (service) => {
      const user = service.user ?? "postgres";
      const database = service.database ?? user;
      const file = `${service.service}.dump`;
      return withServiceUp(
        app,
        service.service,
        Effect.gen(function* () {
          yield* run(app, `dump the ${service.service} database`, [
            "exec",
            "-T",
            service.service,
            "pg_dump",
            "--format=custom",
            `--username=${user}`,
            `--dbname=${database}`,
            `--file=${CONTAINER_DUMP}`,
          ]);
          yield* run(app, "copy the snapshot out of the container", [
            "cp",
            `${service.service}:${CONTAINER_DUMP}`,
            path.join(directory, file),
          ]);
          yield* compose
            .run(app, ["exec", "-T", service.service, "rm", "-f", CONTAINER_DUMP])
            .pipe(Effect.ignore);
          return { service: service.service, file, database, user };
        }),
      );
    }).pipe(
      // Half a snapshot restores half an app, so it is not kept.
      Effect.tapError(() => fs.remove(directory, { recursive: true }).pipe(Effect.ignore)),
    );

    const sizes = yield* Effect.forEach(files, (entry) =>
      fs.stat(path.join(directory, entry.file)).pipe(
        Effect.map((info) => Number(info.size)),
        Effect.orElseSucceed(() => 0),
      ),
    );
    const snapshot: OzoneSnapshot = {
      id,
      projectId: app.app.projectId,
      createdAt: DateTime.formatIso(now),
      reason: input.reason,
      label: input.label ?? null,
      commitSha: yield* headCommit(app.workspaceRoot),
      sizeBytes: sizes.reduce((total, size) => total + size, 0),
    };
    yield* encodeStored({ snapshot, files }).pipe(
      Effect.flatMap((json) => fs.writeFileString(path.join(directory, SNAPSHOT_FILE), json)),
      Effect.mapError(() => failed("Could not record the snapshot.")),
    );
    yield* prune(app);
    return snapshot;
  });

  const restoreStored = Effect.fn("AppData.restoreStored")(function* (
    app: AppRegistry.ResolvedApp,
    stored: StoredSnapshot,
  ) {
    const directory = path.join(appDirectory(app), stored.snapshot.id);
    const appService = app.manifest.runtime.appService;
    const appWasRunning = yield* isRunning(app, appService);
    // Nothing may write to the database while it is replaced.
    yield* run(app, "stop the app before restoring", ["stop", appService]);
    yield* Effect.forEach(
      stored.files,
      (entry) =>
        withServiceUp(
          app,
          entry.service,
          Effect.gen(function* () {
            yield* run(app, "copy the snapshot into the container", [
              "cp",
              path.join(directory, entry.file),
              `${entry.service}:${CONTAINER_DUMP}`,
            ]);
            // A fresh database, so nothing made after the snapshot is left behind in it.
            const sql = (statement: string) =>
              run(app, `prepare the ${entry.service} database`, [
                "exec",
                "-T",
                entry.service,
                "psql",
                `--username=${entry.user}`,
                "--dbname=postgres",
                "--set=ON_ERROR_STOP=1",
                `--command=${statement}`,
              ]);
            yield* sql(`DROP DATABASE IF EXISTS "${entry.database}" WITH (FORCE)`);
            yield* sql(`CREATE DATABASE "${entry.database}" OWNER "${entry.user}"`);
            yield* run(app, `restore the ${entry.service} database`, [
              "exec",
              "-T",
              entry.service,
              "pg_restore",
              "--no-owner",
              "--exit-on-error",
              `--username=${entry.user}`,
              `--dbname=${entry.database}`,
              CONTAINER_DUMP,
            ]);
            yield* compose
              .run(app, ["exec", "-T", entry.service, "rm", "-f", CONTAINER_DUMP])
              .pipe(Effect.ignore);
          }),
        ),
      { discard: true },
    ).pipe(
      Effect.ensuring(
        appWasRunning
          ? compose.run(app, ["up", "--detach", appService]).pipe(Effect.ignore)
          : Effect.void,
      ),
    );
  });

  return AppData.of({
    list: Effect.fn("AppData.list")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      return (yield* listStored(app)).map((stored) => stored.snapshot);
    }),
    snapshot: Effect.fn("AppData.snapshot")(function* (input) {
      const app = yield* registry.resolve(input.projectId);
      return yield* working.withPermits(1)(takeSnapshot(app, input));
    }),
    restore: Effect.fn("AppData.restore")(function* (input) {
      const app = yield* registry.resolve(input.projectId);
      return yield* working.withPermits(1)(
        Effect.gen(function* () {
          const stored = (yield* listStored(app)).find(
            (entry) => entry.snapshot.id === input.snapshotId,
          );
          if (stored === undefined) return yield* failed("That snapshot no longer exists.");
          const safety = yield* takeSnapshot(app, {
            projectId: input.projectId,
            reason: "before-restore",
          });
          yield* restoreStored(app, stored);
          return { safety };
        }),
      );
    }),
  });
});

export const layer = Layer.effect(AppData, make);
