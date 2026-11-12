import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_OZONE_APP_SETTINGS, ProjectId, type OzoneAppManifest } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppCompose from "../runtime/AppCompose.ts";
import * as DockerCli from "../runtime/DockerCli.ts";
import * as AppData from "./AppData.ts";

const projectId = ProjectId.make("project-habits");
const COMMIT = "915fe1691871a4c6f56b9556d41a8faa00cdcc48";
const manifest: OzoneAppManifest = {
  version: 1,
  runtime: {
    kind: "compose",
    file: "compose.yaml",
    appService: "app",
    appPort: 3000,
    healthPath: "/api/health",
  },
  gates: [],
  data: {
    services: [{ service: "db", kind: "postgres", volume: "pgdata", database: "app", user: "app" }],
  },
};
const ok = { code: 0, stdout: "", stderr: "", timedOut: false };

/** What a Compose call does, without the paths and flags that the detailed tests check. */
const step = (args: ReadonlyArray<string>): string => {
  const service = args.at(-1);
  if (args[0] === "ps") return `running? ${service}`;
  if (args[0] === "up") return `start ${service}`;
  if (args[0] === "stop") return `stop ${service}`;
  if (args[0] === "cp") return args[1]?.includes(":") ? "copy out" : "copy in";
  if (args.includes("pg_dump")) return "dump";
  if (args.includes("pg_restore")) return "restore";
  if (args.includes("psql"))
    return args.at(-1)?.includes("DROP") ? "drop database" : "create database";
  if (args.includes("rm")) return "clean up";
  return args.join(" ");
};

const makeHarness = (
  options: {
    readonly dumpFails?: boolean;
    /** A step that waits, once reached, until the test releases it. */
    readonly holdAt?: string;
    /** What `docker volume ls` reports for the app's project. */
    readonly volumes?: ReadonlyArray<string>;
  } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-data-" });
    const calls = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const removals = yield* Ref.make<ReadonlyArray<string>>([]);
    const running = yield* Ref.make<ReadonlySet<string>>(new Set(["app", "db"]));
    const reached = yield* Deferred.make<void>();
    const dockerCalls = yield* Ref.make<ReadonlyArray<string>>([]);

    const docker = Layer.succeed(
      DockerCli.DockerCli,
      DockerCli.DockerCli.of({
        run: Effect.fn("TestDocker.run")(function* (input) {
          const command = input.args.join(" ");
          yield* Ref.update(dockerCalls, (all) => [...all, command]);
          if (input.allowDataRemoval === true) {
            yield* Ref.update(removals, (all) => [...all, command]);
          }
          if (input.args[0] === "volume" && input.args[1] === "ls") {
            return { ...ok, stdout: (options.volumes ?? []).map((name) => `${name}\n`).join("") };
          }
          return ok;
        }),
      }),
    );
    const compose = Layer.succeed(
      AppCompose.AppCompose,
      AppCompose.AppCompose.of({
        run: Effect.fn("TestCompose.run")(function* (_app, args) {
          if (step(args) === options.holdAt) {
            yield* Deferred.succeed(reached, undefined);
            yield* Effect.sleep(Duration.minutes(1));
          }
          yield* Ref.update(calls, (all) => [...all, args]);
          const service = args.at(-1) ?? "";
          if (args[0] === "ps") {
            return {
              ...ok,
              stdout: (yield* Ref.get(running)).has(service) ? "container-id\n" : "",
            };
          }
          if (args[0] === "up") yield* Ref.update(running, (set) => new Set([...set, service]));
          if (args[0] === "stop") {
            yield* Ref.update(
              running,
              (set) => new Set([...set].filter((name) => name !== service)),
            );
          }
          if (args.includes("pg_dump") && options.dumpFails === true) {
            return { ...ok, code: 1, stderr: "pg_dump: error: connection to server failed" };
          }
          // What `docker compose cp` leaves on the host.
          if (args[0] === "cp" && args[1]?.startsWith("db:")) {
            yield* fs.writeFileString(args[2] ?? "", "PGDMP data").pipe(Effect.orDie);
          }
          return ok;
        }),
      }),
    );
    const data = yield* AppData.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          compose,
          docker,
          Layer.mock(AppRegistry.AppRegistry)({
            resolve: () =>
              Effect.succeed({
                app: {
                  projectId,
                  slug: "habits-a1b2c3",
                  name: "Habits",
                  templateId: "web-app",
                  port: 41_000,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  settings: DEFAULT_OZONE_APP_SETTINGS,
                },
                workspaceRoot: path.join(root, "habits"),
                manifest,
              }),
          }),
          Layer.mock(GitVcsDriver.GitVcsDriver)({
            execute: () =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: `${COMMIT}\n`,
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
          }),
          ServerConfig.layerTest(root, { prefix: "ozone-data-home-" }),
        ),
      ),
    );
    const steps = Ref.get(calls).pipe(Effect.map((all) => all.map(step)));
    const forget = Ref.set(calls, []);
    return { data, calls, steps, forget, running, removals, reached, dockerCalls };
  });

const layerTest = Layer.merge(NodeServices.layer, NodeCrypto.layer);

describe("AppData", () => {
  it.effect("dumps inside the container, copies the file out and records the commit", () =>
    Effect.gen(function* () {
      const { data, calls, steps } = yield* makeHarness();
      const snapshot = yield* data.snapshot({ projectId, reason: "manual", label: "before v2" });

      assert.deepStrictEqual(yield* steps, [
        "running? db",
        "start db",
        "dump",
        "copy out",
        "clean up",
      ]);
      const [, , dump, copy] = yield* Ref.get(calls);
      assert.deepStrictEqual(dump, [
        "exec",
        "-T",
        "db",
        "pg_dump",
        "--format=custom",
        "--username=app",
        "--dbname=app",
        "--file=/tmp/ozone-snapshot.dump",
      ]);
      assert.strictEqual(copy?.[1], "db:/tmp/ozone-snapshot.dump");
      // The file lands in Ozone's home, never inside the app's own folder.
      assert.match(copy?.[2] ?? "", /\/ozone\/backups\/habits-a1b2c3\/[^/]+\/db\.dump$/);
      assert.notInclude(copy?.[2] ?? "", "/habits/");

      assert.deepStrictEqual(
        { ...snapshot, id: "", createdAt: "" },
        {
          id: "",
          projectId,
          createdAt: "",
          reason: "manual",
          label: "before v2",
          commitSha: COMMIT,
          sizeBytes: "PGDMP data".length,
        },
      );
      assert.deepStrictEqual(yield* data.list(projectId), [snapshot]);

      // Another of the app's projects, such as production, keeps its snapshots apart.
      const fs = yield* FileSystem.FileSystem;
      const copies = yield* Ref.make<ReadonlyArray<string>>([]);
      const production: AppData.DataTarget = {
        projectId,
        folder: "habits-a1b2c3/production",
        databases: manifest.data.services,
        compose: (args) =>
          Effect.gen(function* () {
            if (args[0] === "cp" && args[1]?.startsWith("db:")) {
              yield* Ref.update(copies, (all) => [...all, args[2] ?? ""]);
              yield* fs.writeFileString(args[2] ?? "", "PGDMP prod").pipe(Effect.orDie);
            }
            return { ...ok, stdout: args[0] === "ps" ? "container-id\n" : "" };
          }),
        commitSha: Effect.succeed("c0ffee"),
      };
      const kept = yield* data.snapshotOf(production, { reason: "before-deploy" });
      assert.strictEqual(kept.commitSha, "c0ffee");
      assert.match(
        (yield* Ref.get(copies))[0] ?? "",
        /\/ozone\/backups\/habits-a1b2c3\/production\/[^/]+\/db\.dump$/,
      );
      assert.deepStrictEqual(yield* data.list(projectId), [snapshot]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("starts a stopped database for the dump and stops it again afterwards", () =>
    Effect.gen(function* () {
      const { data, steps, running } = yield* makeHarness();
      yield* Ref.set(running, new Set<string>());
      yield* data.snapshot({ projectId, reason: "manual" });
      assert.deepStrictEqual(yield* steps, [
        "running? db",
        "start db",
        "dump",
        "copy out",
        "clean up",
        "stop db",
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps nothing when the dump fails", () =>
    Effect.gen(function* () {
      const { data } = yield* makeHarness({ dumpFails: true });
      const error = yield* Effect.flip(data.snapshot({ projectId, reason: "task" }));
      assert.strictEqual(error.reason, "failed");
      assert.include(error.message, "connection to server failed");
      assert.deepStrictEqual(yield* data.list(projectId), []);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("removes only the volumes its snapshot holds, and only behind it", () =>
    Effect.gen(function* () {
      const { data, steps, removals, dockerCalls } = yield* makeHarness({
        volumes: [
          "habits-a1b2c3_pgdata",
          "habits-a1b2c3_node_modules",
          "habits-a1b2c3_uploads",
          // Production's database, as if Docker's filter had let it through.
          "habits-a1b2c3-prod_pgdata",
        ],
      });
      const { snapshot } = yield* data.remove(projectId);

      assert.deepStrictEqual(yield* steps, [
        "running? db",
        "start db",
        "dump",
        "copy out",
        "clean up",
        "down --remove-orphans",
      ]);
      assert.strictEqual(snapshot.reason, "before-delete");
      assert.include(
        (yield* Ref.get(dockerCalls)).join(" | "),
        "label=com.docker.compose.project=habits-a1b2c3",
      );
      // The one place in Ozone that asks Docker's guard to let a volume go.
      assert.deepStrictEqual(yield* Ref.get(removals), ["volume rm habits-a1b2c3_pgdata"]);
      assert.deepStrictEqual(yield* data.list(projectId), [snapshot]);

      const failing = yield* makeHarness({ dumpFails: true, volumes: ["habits-a1b2c3_pgdata"] });
      yield* Effect.flip(failing.data.remove(projectId));
      assert.notInclude(yield* failing.steps, "down --remove-orphans");
      assert.deepStrictEqual(yield* Ref.get(failing.removals), []);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("restores into a fresh database, behind a snapshot of the data it replaces", () =>
    Effect.gen(function* () {
      const { data, calls, steps, forget, running } = yield* makeHarness();
      const wanted = yield* data.snapshot({ projectId, reason: "manual" });
      yield* TestClock.adjust("1 minute");
      yield* forget;

      const { safety } = yield* data.restore({ projectId, snapshotId: wanted.id });

      assert.deepStrictEqual(yield* steps, [
        // First a copy of what is about to be replaced.
        "running? db",
        "start db",
        "dump",
        "copy out",
        "clean up",
        // Then nothing may write while the database is swapped.
        "running? app",
        "stop app",
        "running? db",
        "start db",
        "copy in",
        "drop database",
        "create database",
        "restore",
        "clean up",
        "start app",
      ]);
      assert.strictEqual(safety.reason, "before-restore");
      assert.deepStrictEqual(
        (yield* data.list(projectId)).map((snapshot) => snapshot.id),
        [safety.id, wanted.id],
      );
      const restore = (yield* Ref.get(calls)).find((args) => args.includes("pg_restore"));
      assert.deepStrictEqual(restore?.slice(3), [
        "pg_restore",
        "--no-owner",
        "--exit-on-error",
        "--username=app",
        "--dbname=app",
        "/tmp/ozone-snapshot.dump",
      ]);

      const missing = yield* Effect.flip(data.restore({ projectId, snapshotId: "not-a-snapshot" }));
      assert.include(missing.message, "no longer exists");

      // A stopped app stays stopped; History starts it once its code matches the data again.
      yield* Ref.set(running, new Set(["db"]));
      yield* forget;
      yield* data.restore({ projectId, snapshotId: wanted.id });
      assert.notInclude(yield* steps, "start app");
    }).pipe(Effect.provide(layerTest)),
  );

  // A restore is confirmed once; a client that disconnects mid-swap must not leave the database
  // dropped and empty.
  it.effect("finishes swapping the database when its caller goes away", () =>
    Effect.gen(function* () {
      const { data, steps, forget, reached } = yield* makeHarness({ holdAt: "drop database" });
      const wanted = yield* data.snapshot({ projectId, reason: "manual" });
      yield* forget;
      const restoring = yield* Effect.forkChild(data.restore({ projectId, snapshotId: wanted.id }));
      yield* Deferred.await(reached);
      yield* Fiber.interrupt(restoring);
      yield* TestClock.adjust(Duration.minutes(1));
      // Waits its turn behind the restore, so the steps before it are all the restore took.
      yield* data.snapshot({ projectId, reason: "manual" });
      assert.include(
        (yield* steps).join(" | "),
        "drop database | create database | restore | clean up | start app",
      );
    }).pipe(Effect.provide(layerTest)),
  );

  // An agent's restart or a settings change mid-restore would start the app on a database that
  // was just dropped. Every start and stop of the app goes through this lock.
  it.effect("keeps the app's starts and stops out until a restore is done", () =>
    Effect.gen(function* () {
      const { data, steps, forget, reached } = yield* makeHarness({ holdAt: "drop database" });
      const wanted = yield* data.snapshot({ projectId, reason: "manual" });
      yield* forget;
      yield* Effect.forkChild(data.restore({ projectId, snapshotId: wanted.id }));
      yield* Deferred.await(reached);

      const ran = yield* Ref.make(false);
      const start = yield* Effect.forkChild(data.exclusive(projectId, Ref.set(ran, true)));
      yield* TestClock.adjust(Duration.seconds(30));
      assert.isFalse(yield* Ref.get(ran));
      yield* TestClock.adjust(Duration.minutes(1));
      yield* Fiber.join(start);
      assert.isTrue(yield* Ref.get(ran));
      assert.strictEqual((yield* steps).at(-1), "start app");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("prunes routine snapshots and never one a person relies on", () =>
    Effect.gen(function* () {
      const { data } = yield* makeHarness();
      const manual = yield* data.snapshot({ projectId, reason: "manual" });
      yield* TestClock.adjust("1 minute");
      // The undo point an earlier restore left.
      const undo = yield* data.snapshot({ projectId, reason: "before-restore" });
      const automatic: Array<string> = [];
      for (let index = 0; index < 23; index++) {
        yield* TestClock.adjust("1 minute");
        automatic.push((yield* data.snapshot({ projectId, reason: "task" })).id);
      }
      const kept = (yield* data.list(projectId)).map((snapshot) => snapshot.id);
      assert.deepStrictEqual(kept, [...automatic.slice(3).toReversed(), undo.id, manual.id]);

      // The safety snapshot a restore takes must not prune the snapshot being restored.
      const oldest = automatic[3] ?? "";
      yield* TestClock.adjust("1 minute");
      const { safety } = yield* data.restore({ projectId, snapshotId: oldest });
      const after = (yield* data.list(projectId)).map((snapshot) => snapshot.id);
      assert.include(after, oldest);
      assert.include(after, safety.id);
    }).pipe(Effect.provide(layerTest)),
  );
});
