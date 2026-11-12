import {
  OzoneAppError,
  OzoneSnapshot,
  type OzoneDataRestoreInput,
  type OzoneDataRestoreResult,
  type OzoneDataService,
  type OzoneSnapshotReason,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppCompose from "../runtime/AppCompose.ts";
import * as DockerCli from "../runtime/DockerCli.ts";

export interface SnapshotInput {
  readonly projectId: ProjectId;
  readonly reason: OzoneSnapshotReason;
  readonly label?: string;
}

/**
 * Where a project's data lives and how Docker reaches it: an app's development project, or its
 * production one on this machine or a server.
 */
export interface DataTarget {
  readonly projectId: ProjectId;
  /** The snapshots' folder, under Ozone's backups. */
  readonly folder: string;
  /** The Postgres services whose databases a snapshot holds. */
  readonly databases: ReadonlyArray<OzoneDataService>;
  readonly compose: (
    args: ReadonlyArray<string>,
    options?: { readonly timeout?: Duration.Input },
  ) => Effect.Effect<DockerCli.DockerRunOutput, OzoneAppError>;
  /** The commit the data belongs with. */
  readonly commitSha: Effect.Effect<string | null>;
}

export interface RestoreOfInput {
  readonly snapshotId: string;
  /** Stopped while its database is replaced. */
  readonly appService: string;
  /** Brings the app back when it was running. Left out, the app stays stopped. */
  readonly restart?: Effect.Effect<void, OzoneAppError>;
}

/** An app's folder of snapshots under Ozone's state, which outlives the app itself. */
export const backupFolder = (path: Path.Path, stateDir: string, slug: string) =>
  path.join(stateDir, "ozone", "backups", slug);

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
    /**
     * Removes the app's containers, and the volumes its snapshot holds, after that snapshot is
     * kept. The only caller is the "Delete app" flow a person confirmed.
     */
    readonly remove: (
      projectId: ProjectId,
    ) => Effect.Effect<{ readonly snapshot: OzoneSnapshot }, OzoneAppError>;
    /**
     * Runs `effect` while no restore or delete of the app is under way, and holds the next one back
     * until it ends. Every start and stop of the app goes through it.
     */
    readonly exclusive: <A, E, R>(
      projectId: ProjectId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    /**
     * For an app brought back after a delete: loads its newest snapshot into its new, empty
     * volumes and leaves the app stopped. Volumes still in Docker hold newer data than any
     * snapshot, so they are left as they are. Returns the snapshot it loaded, if any.
     */
    readonly revive: (projectId: ProjectId) => Effect.Effect<OzoneSnapshot | null, OzoneAppError>;
    /** The same for another of the app's projects, such as its production one. */
    readonly listOf: (
      target: Pick<DataTarget, "projectId" | "folder">,
    ) => Effect.Effect<ReadonlyArray<OzoneSnapshot>>;
    readonly snapshotOf: (
      target: DataTarget,
      input: { readonly reason: OzoneSnapshotReason; readonly label?: string },
    ) => Effect.Effect<OzoneSnapshot, OzoneAppError>;
    readonly restoreOf: (
      target: DataTarget,
      input: RestoreOfInput,
    ) => Effect.Effect<OzoneDataRestoreResult, OzoneAppError>;
    readonly loadOf: (
      target: DataTarget,
      input: RestoreOfInput,
    ) => Effect.Effect<void, OzoneAppError>;
  }
>()("t3/ozone/data/AppData") {}

const SNAPSHOT_FILE = "snapshot.json";
const CONTAINER_DUMP = "/tmp/ozone-snapshot.dump";
/**
 * Routine snapshots are pruned to the newest 20 per app. The rest are kept: a person's own, and the
 * undo point of a restore or a delete. Pruning only after a routine one also means a restore's safety
 * snapshot can never prune the snapshot being restored.
 */
const PRUNED_REASONS: ReadonlySet<OzoneSnapshotReason> = new Set([
  "task",
  "before-rebuild",
  "before-deploy",
]);
const ROUTINE_SNAPSHOTS_KEPT = 20;
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
/** What a failed command said, kept short. */
const tail = (output: { readonly stdout: string; readonly stderr: string }) =>
  (output.stderr.trim() || output.stdout.trim()).slice(-600);
const databasesOf = (app: AppRegistry.ResolvedApp) =>
  app.manifest.data.services.filter((service) => service.kind === "postgres");

export const make = Effect.gen(function* () {
  const registry = yield* AppRegistry.AppRegistry;
  const compose = yield* AppCompose.AppCompose;
  const docker = yield* DockerCli.DockerCli;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const random = yield* SecureRandom.SecureRandom;
  // One data operation at a time: a restore must never overlap a snapshot of the same database.
  const working = yield* Semaphore.make(1);
  // Per app, so a restore also keeps the app's own starts out. Taken before `working`, never after.
  const appLocks = new Map<ProjectId, Semaphore.Semaphore>();
  const exclusive = <A, E, R>(projectId: ProjectId, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      const existing = appLocks.get(projectId);
      const lock = existing ?? Semaphore.makeUnsafe(1);
      if (existing === undefined) appLocks.set(projectId, lock);
      return lock.withPermits(1)(effect);
    });
  const scope = yield* Scope.Scope;
  /**
   * Runs in the service's own fiber, so a caller that goes away stops waiting, not the work: a
   * restore cut off between dropping and reloading a database would leave it empty.
   */
  const toTheEnd = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.forkIn(effect, scope).pipe(Effect.flatMap(Fiber.join));

  const folderOf = (target: Pick<DataTarget, "folder">) =>
    backupFolder(path, config.stateDir, target.folder);
  // Called once the helpers below exist.
  const devTarget = (app: AppRegistry.ResolvedApp): DataTarget => ({
    projectId: app.app.projectId,
    folder: app.app.slug,
    databases: databasesOf(app),
    compose: (args, options) => compose.run(app, args, options),
    commitSha: headCommit(app.workspaceRoot),
  });

  /** Runs a Compose command and turns a non-zero exit into a failure that says what was tried. */
  const run = Effect.fn("AppData.run")(function* (
    target: DataTarget,
    doing: string,
    args: ReadonlyArray<string>,
  ) {
    const output = yield* target.compose(args, { timeout: DUMP_TIMEOUT });
    if (output.code !== 0) {
      const detail = tail(output);
      return yield* failed(`Could not ${doing}.${detail.length === 0 ? "" : ` ${detail}`}`);
    }
    return output;
  });

  const isRunning = (target: DataTarget, service: string) =>
    target
      .compose(["ps", "--status", "running", "--quiet", service])
      .pipe(Effect.map((output) => output.code === 0 && output.stdout.trim().length > 0));

  /** Runs `use` with the service up, and puts a service that was stopped back to stopped. */
  const withServiceUp = Effect.fn("AppData.withServiceUp")(function* <A>(
    target: DataTarget,
    service: string,
    use: Effect.Effect<A, OzoneAppError>,
  ) {
    const wasRunning = yield* isRunning(target, service);
    yield* run(target, `start the ${service} service`, ["up", "--detach", "--wait", service]);
    return yield* use.pipe(
      Effect.ensuring(
        wasRunning ? Effect.void : target.compose(["stop", service]).pipe(Effect.ignore),
      ),
    );
  });

  const readStored = (directory: string) =>
    fs
      .readFileString(path.join(directory, SNAPSHOT_FILE))
      .pipe(Effect.flatMap(decodeStored), Effect.option);

  const listStored = Effect.fn("AppData.listStored")(function* (
    target: Pick<DataTarget, "projectId" | "folder">,
  ) {
    const directory = folderOf(target);
    const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
    const stored = yield* Effect.forEach(names, (name) => readStored(path.join(directory, name)));
    return (
      stored
        .flatMap(Option.toArray)
        // An app brought back after a delete has a new project; its snapshots are still its own.
        .map((entry) => ({
          ...entry,
          snapshot: { ...entry.snapshot, projectId: target.projectId },
        }))
        .toSorted((left, right) => right.snapshot.id.localeCompare(left.snapshot.id))
    );
  });

  const prune = Effect.fn("AppData.prune")(function* (target: DataTarget) {
    const routine = (yield* listStored(target)).filter((stored) =>
      PRUNED_REASONS.has(stored.snapshot.reason),
    );
    yield* Effect.forEach(
      routine.slice(ROUTINE_SNAPSHOTS_KEPT),
      (stored) =>
        fs
          .remove(path.join(folderOf(target), stored.snapshot.id), { recursive: true })
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
    target: DataTarget,
    input: { readonly reason: OzoneSnapshotReason; readonly label?: string },
  ) {
    const now = yield* DateTime.now;
    const suffix = yield* random.uuidV4().pipe(
      Effect.map((uuid) => uuid.slice(0, 8)),
      Effect.mapError(() => failed("Could not name the snapshot.")),
    );
    // Sorts by time, so the newest snapshot is the last folder name.
    const id = `${DateTime.formatIso(now).replace(/[-:.]/g, "")}-${suffix}`;
    const directory = path.join(folderOf(target), id);
    yield* fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(() => failed("Could not create the snapshot folder.")));

    const files = yield* Effect.forEach(target.databases, (service) => {
      const user = service.user ?? "postgres";
      const database = service.database ?? user;
      const file = `${service.service}.dump`;
      return withServiceUp(
        target,
        service.service,
        Effect.gen(function* () {
          yield* run(target, `dump the ${service.service} database`, [
            "exec",
            "-T",
            service.service,
            "pg_dump",
            "--format=custom",
            `--username=${user}`,
            `--dbname=${database}`,
            `--file=${CONTAINER_DUMP}`,
          ]);
          yield* run(target, "copy the snapshot out of the container", [
            "cp",
            `${service.service}:${CONTAINER_DUMP}`,
            path.join(directory, file),
          ]);
          yield* target
            .compose(["exec", "-T", service.service, "rm", "-f", CONTAINER_DUMP])
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
      projectId: target.projectId,
      createdAt: DateTime.formatIso(now),
      reason: input.reason,
      label: input.label ?? null,
      commitSha: yield* target.commitSha,
      sizeBytes: sizes.reduce((total, size) => total + size, 0),
    };
    yield* encodeStored({ snapshot, files }).pipe(
      Effect.flatMap((json) => fs.writeFileString(path.join(directory, SNAPSHOT_FILE), json)),
      Effect.mapError(() => failed("Could not record the snapshot.")),
    );
    if (PRUNED_REASONS.has(input.reason)) yield* prune(target);
    return snapshot;
  });

  /** Replaces the target's databases with a stored snapshot's, with the app stopped meanwhile. */
  const restoreStored = Effect.fn("AppData.restoreStored")(function* (
    target: DataTarget,
    stored: StoredSnapshot,
    input: RestoreOfInput,
  ) {
    const directory = path.join(folderOf(target), stored.snapshot.id);
    const appService = input.appService;
    const restart =
      input.restart !== undefined && (yield* isRunning(target, appService))
        ? input.restart
        : Effect.void;
    // Nothing may write to the database while it is replaced.
    yield* run(target, "stop the app before restoring", ["stop", appService]);
    yield* Effect.forEach(
      stored.files,
      (entry) =>
        withServiceUp(
          target,
          entry.service,
          Effect.gen(function* () {
            yield* run(target, "copy the snapshot into the container", [
              "cp",
              path.join(directory, entry.file),
              `${entry.service}:${CONTAINER_DUMP}`,
            ]);
            // A fresh database, so nothing made after the snapshot is left behind in it.
            const sql = (statement: string) =>
              run(target, `prepare the ${entry.service} database`, [
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
            yield* run(target, `restore the ${entry.service} database`, [
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
            yield* target
              .compose(["exec", "-T", entry.service, "rm", "-f", CONTAINER_DUMP])
              .pipe(Effect.ignore);
          }),
        ),
      { discard: true },
    ).pipe(
      // A restore that failed still brings back the app it stopped.
      Effect.tapError(() => restart.pipe(Effect.ignore)),
    );
    yield* restart;
  });

  const findStored = Effect.fn("AppData.findStored")(function* (
    target: DataTarget,
    snapshotId: string,
  ) {
    const stored = (yield* listStored(target)).find((entry) => entry.snapshot.id === snapshotId);
    return stored ?? (yield* failed("That snapshot no longer exists."));
  });
  const restoreIn = Effect.fn("AppData.restoreIn")(function* (
    target: DataTarget,
    input: RestoreOfInput,
  ) {
    const stored = yield* findStored(target, input.snapshotId);
    const safety = yield* takeSnapshot(target, { reason: "before-restore" });
    yield* restoreStored(target, stored, input);
    return { safety };
  });
  const loadIn = Effect.fn("AppData.loadIn")(function* (target: DataTarget, input: RestoreOfInput) {
    yield* restoreStored(target, yield* findStored(target, input.snapshotId), input);
  });
  /** The app's volumes in Docker that a snapshot holds: its databases'. */
  const dataVolumes = Effect.fn("AppData.dataVolumes")(function* (
    app: AppRegistry.ResolvedApp,
    orFail: (detail: string) => OzoneAppError,
  ) {
    const covered = new Set(databasesOf(app).map((service) => `${app.app.slug}_${service.volume}`));
    const listed = yield* docker
      .run({
        args: [
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${app.app.slug}`,
        ],
        timeout: DUMP_TIMEOUT,
      })
      .pipe(Effect.mapError((error) => orFail(error.detail)));
    return listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((name) => covered.has(name));
  });

  /** Development's app comes back the way it always has: started, and not waited for. */
  const devRestore = (app: AppRegistry.ResolvedApp, snapshotId: string): RestoreOfInput => ({
    snapshotId,
    appService: app.manifest.runtime.appService,
    restart: devTarget(app)
      .compose(["up", "--detach", app.manifest.runtime.appService])
      .pipe(Effect.ignore),
  });

  return AppData.of({
    list: Effect.fn("AppData.list")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      return (yield* listStored(devTarget(app))).map((stored) => stored.snapshot);
    }),
    snapshot: Effect.fn("AppData.snapshot")(function* (input) {
      const app = yield* registry.resolve(input.projectId);
      return yield* working.withPermits(1)(takeSnapshot(devTarget(app), input));
    }),
    restore: Effect.fn("AppData.restore")(function* (input) {
      const app = yield* registry.resolve(input.projectId);
      return yield* toTheEnd(
        exclusive(
          input.projectId,
          working.withPermits(1)(restoreIn(devTarget(app), devRestore(app, input.snapshotId))),
        ),
      );
    }),
    remove: Effect.fn("AppData.remove")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      return yield* toTheEnd(
        exclusive(
          projectId,
          working.withPermits(1)(
            Effect.gen(function* () {
              // First, and nothing is removed unless it worked.
              const snapshot = yield* takeSnapshot(devTarget(app), { reason: "before-delete" });
              const saved = `The data is saved as snapshot ${snapshot.id}, but`;
              const down = yield* compose.run(app, ["down", "--remove-orphans"], {
                timeout: DUMP_TIMEOUT,
              });
              if (down.code !== 0) {
                return yield* failed(
                  `${saved} the containers could not be removed. ${tail(down)}`.trim(),
                );
              }
              // Only the volumes the snapshot holds go; any other volume stays in Docker.
              const unsaved = (detail: string) => failed(`${saved} ${detail}`);
              yield* Effect.forEach(
                yield* dataVolumes(app, unsaved),
                Effect.fn("AppData.removeVolume")(function* (name) {
                  const output = yield* docker
                    .run({
                      args: ["volume", "rm", name],
                      timeout: DUMP_TIMEOUT,
                      allowDataRemoval: true,
                    })
                    .pipe(Effect.mapError((error) => unsaved(error.detail)));
                  if (output.code !== 0) {
                    return yield* failed(
                      `${saved} the volume ${name} could not be removed. ${tail(output)}`.trim(),
                    );
                  }
                }),
                { discard: true },
              );
              return { snapshot };
            }),
          ),
        ),
      );
    }),
    exclusive,
    revive: Effect.fn("AppData.revive")(function* (projectId) {
      const app = yield* registry.resolve(projectId);
      const target = devTarget(app);
      return yield* toTheEnd(
        exclusive(
          projectId,
          working.withPermits(1)(
            Effect.gen(function* () {
              const kept = yield* dataVolumes(app, failed);
              const [newest] = yield* listStored(target);
              if (kept.length > 0 || newest === undefined) return null;
              yield* loadIn(target, {
                snapshotId: newest.snapshot.id,
                appService: app.manifest.runtime.appService,
              });
              return newest.snapshot;
            }),
          ),
        ),
      );
    }),
    listOf: Effect.fn("AppData.listOf")(function* (target) {
      return (yield* listStored(target)).map((stored) => stored.snapshot);
    }),
    snapshotOf: Effect.fn("AppData.snapshotOf")((target, input) =>
      working.withPermits(1)(takeSnapshot(target, input)),
    ),
    restoreOf: Effect.fn("AppData.restoreOf")((target, input) =>
      toTheEnd(working.withPermits(1)(restoreIn(target, input))),
    ),
    loadOf: Effect.fn("AppData.loadOf")((target, input) =>
      toTheEnd(working.withPermits(1)(loadIn(target, input))),
    ),
  });
});

export const layer = Layer.effect(AppData, make);
